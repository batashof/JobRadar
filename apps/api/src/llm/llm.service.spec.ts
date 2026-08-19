import { ConfigService } from '@nestjs/config';

import { LlmService } from './llm.service';
import { LlmUnavailableError } from './llm.types';

function configWith(env: Record<string, string>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

function okResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function errorResponse(status: number, body = 'rate limited'): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('LlmService', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('reports unconfigured when no provider key is set', () => {
    const service = new LlmService(configWith({}));
    expect(service.isConfigured()).toBe(false);
    expect(service.configuredProviderNames()).toEqual([]);
  });

  it('throws LlmUnavailableError without calling anyone when unconfigured', async () => {
    const service = new LlmService(configWith({}));
    await expect(service.complete({ user: 'hi' })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the first configured provider in order', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('hello'));
    const service = new LlmService(configWith({ GROQ_API_KEY: 'gk', GEMINI_API_KEY: 'mk' }));

    const result = await service.complete({ system: 'sys', user: 'hi' });

    expect(result).toEqual({ text: 'hello', provider: 'groq', model: 'llama-3.3-70b-versatile' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(init.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gk');
  });

  it('skips unconfigured providers (openrouter only → openrouter is used)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('via openrouter'));
    const service = new LlmService(configWith({ OPENROUTER_API_KEY: 'ok' }));

    const result = await service.complete({ user: 'hi' });

    expect(result.provider).toBe('openrouter');
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('fails over to the next provider on a rate-limit error', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse('via gemini'));
    const service = new LlmService(configWith({ GROQ_API_KEY: 'gk', GEMINI_API_KEY: 'mk' }));

    const result = await service.complete({ user: 'hi' });

    expect(result.provider).toBe('gemini');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails over on network errors and empty completions too', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(okResponse(''))
      .mockResolvedValueOnce(okResponse('finally'));
    const service = new LlmService(
      configWith({ GROQ_API_KEY: 'a', OPENROUTER_API_KEY: 'b', GEMINI_API_KEY: 'c' }),
    );

    const result = await service.complete({ user: 'hi' });

    expect(result.provider).toBe('gemini');
    expect(result.text).toBe('finally');
  });

  it('throws LlmUnavailableError when every provider fails', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, 'boom'));
    const service = new LlmService(configWith({ GROQ_API_KEY: 'a', GEMINI_API_KEY: 'c' }));

    await expect(service.complete({ user: 'hi' })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe('providerStatus', () => {
    it('lists configured providers and their models before any call', () => {
      const service = new LlmService(configWith({ GROQ_API_KEY: 'gk', GEMINI_API_KEY: 'mk' }));

      expect(service.providerStatus()).toEqual([
        {
          name: 'groq',
          model: 'llama-3.3-70b-versatile',
          lastOutcome: null,
          lastError: null,
          lastAt: null,
        },
        {
          name: 'gemini',
          model: 'gemini-flash-latest',
          lastOutcome: null,
          lastError: null,
          lastAt: null,
        },
      ]);
    });

    it('records the failure that made the chain fall over, and the one that worked', async () => {
      // A caller only ever sees the successful answer, so without this a chain
      // limping along on its last provider looks exactly like a healthy one.
      fetchMock
        .mockResolvedValueOnce(errorResponse(403, 'Access denied. Check your network settings.'))
        .mockResolvedValueOnce(okResponse('hi'));
      const service = new LlmService(configWith({ GROQ_API_KEY: 'gk', GEMINI_API_KEY: 'mk' }));

      await service.complete({ user: 'hi' });
      const [groq, gemini] = service.providerStatus();

      expect(groq).toMatchObject({ lastOutcome: 'failed' });
      expect(groq?.lastError).toContain('403');
      expect(gemini).toMatchObject({ lastOutcome: 'ok', lastError: null });
      expect(Number.isNaN(Date.parse(gemini?.lastAt ?? ''))).toBe(false);
    });

    it('clears a stale error once the provider recovers', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(429)).mockResolvedValueOnce(okResponse('hi'));
      const service = new LlmService(configWith({ GROQ_API_KEY: 'gk' }));

      await expect(service.complete({ user: 'hi' })).rejects.toBeInstanceOf(LlmUnavailableError);
      expect(service.providerStatus()[0]?.lastOutcome).toBe('failed');

      await service.complete({ user: 'hi' });
      expect(service.providerStatus()[0]).toMatchObject({ lastOutcome: 'ok', lastError: null });
    });

    it('truncates a long error body rather than pasting a provider page into /health', async () => {
      fetchMock.mockResolvedValue(errorResponse(500, 'x'.repeat(5000)));
      const service = new LlmService(configWith({ GROQ_API_KEY: 'gk' }));

      await expect(service.complete({ user: 'hi' })).rejects.toBeInstanceOf(LlmUnavailableError);
      expect(service.providerStatus()[0]?.lastError?.length).toBeLessThanOrEqual(200);
    });

    it('never carries the API key into the reported error', async () => {
      fetchMock.mockResolvedValue(errorResponse(401, 'invalid api key'));
      const service = new LlmService(configWith({ GROQ_API_KEY: 'super-secret-key' }));

      await expect(service.complete({ user: 'hi' })).rejects.toBeInstanceOf(LlmUnavailableError);
      expect(JSON.stringify(service.providerStatus())).not.toContain('super-secret-key');
    });
  });

  it('honors model override env vars', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('x'));
    const service = new LlmService(
      configWith({ GROQ_API_KEY: 'gk', GROQ_MODEL: 'llama-4-scout' }),
    );

    const result = await service.complete({ user: 'hi' });

    expect(result.model).toBe('llama-4-scout');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      model: string;
    };
    expect(body.model).toBe('llama-4-scout');
  });
});
