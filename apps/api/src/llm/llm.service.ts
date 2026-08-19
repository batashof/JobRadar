import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LlmRequest, LlmResult, LlmUnavailableError } from './llm.types';

/**
 * All three free-tier providers expose an OpenAI-compatible chat-completions
 * endpoint, so one HTTP shape covers the whole failover chain (ADR-005).
 */
interface ProviderDef {
  name: string;
  baseUrl: string;
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
  },
  {
    name: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    // Evergreen alias — pinned models age out of the free tier (2.0-flash has
    // no free quota anymore; 2.5-flash is closed to new users).
    defaultModel: 'gemini-flash-latest',
  },
];

const REQUEST_TIMEOUT_MS = 60_000;

/** How much of a provider's error body is worth keeping for diagnostics. */
const ERROR_DETAIL_LIMIT = 200;

/** Last outcome of a provider, as `/health` reports it. */
export interface LlmProviderStatus {
  name: string;
  model: string;
  /** null until the provider has been called at least once in this process. */
  lastOutcome: 'ok' | 'failed' | null;
  lastError: string | null;
  lastAt: string | null;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  /**
   * Last outcome per provider, in memory only. A provider failing is not an
   * error the caller ever sees — the chain fails over, and a caller that runs
   * out of providers degrades instead of throwing (the digest falls back to its
   * rules ranking). That is the right behaviour and it also made a total LLM
   * outage invisible: for three days the digest went out ranked by keywords and
   * nothing said why. This is what `/health` reads to answer "is the LLM
   * actually working right now", without exposing a key or a prompt.
   */
  private readonly status = new Map<string, Omit<LlmProviderStatus, 'name' | 'model'>>();

  constructor(private readonly config: ConfigService) {}

  /** True when at least one provider has an API key set. */
  isConfigured(): boolean {
    return this.configuredProviders().length > 0;
  }

  /** Names of configured providers, in failover order (for /health diagnostics). */
  configuredProviderNames(): string[] {
    return this.configuredProviders().map((p) => p.name);
  }

  /**
   * Per-provider health: the model in use and how its last call went. Resets on
   * restart — this is a live signal, not a log; `lastOutcome: null` means the
   * process has not called that provider yet, which on a free-tier instance
   * that sleeps is a common and unalarming state.
   */
  providerStatus(): LlmProviderStatus[] {
    return this.configuredProviders().map((provider) => ({
      name: provider.name,
      model: this.config.get<string>(provider.modelEnv) ?? provider.defaultModel,
      lastOutcome: this.status.get(provider.name)?.lastOutcome ?? null,
      lastError: this.status.get(provider.name)?.lastError ?? null,
      lastAt: this.status.get(provider.name)?.lastAt ?? null,
    }));
  }

  private record(provider: string, outcome: 'ok' | 'failed', error?: string): void {
    this.status.set(provider, {
      lastOutcome: outcome,
      lastError: error ? error.slice(0, ERROR_DETAIL_LIMIT) : null,
      lastAt: new Date().toISOString(),
    });
  }

  /**
   * Runs the prompt through the first configured provider, failing over to the
   * next on any error (rate limit, quota, network, malformed response).
   */
  async complete(request: LlmRequest): Promise<LlmResult> {
    const providers = this.configuredProviders();
    if (providers.length === 0) {
      throw new LlmUnavailableError(
        'No LLM provider configured — set GROQ_API_KEY, OPENROUTER_API_KEY or GEMINI_API_KEY',
      );
    }

    const failures: string[] = [];
    for (const provider of providers) {
      try {
        const result = await this.completeWith(provider, request);
        this.record(provider.name, 'ok');
        return result;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.record(provider.name, 'failed', reason);
        failures.push(`${provider.name}: ${reason}`);
        this.logger.warn(`LLM provider ${provider.name} failed, trying next: ${reason}`);
      }
    }
    throw new LlmUnavailableError(`All LLM providers failed (${failures.join('; ')})`);
  }

  private configuredProviders(): ProviderDef[] {
    return PROVIDERS.filter((p) => !!this.config.get<string>(p.keyEnv));
  }

  private async completeWith(provider: ProviderDef, request: LlmRequest): Promise<LlmResult> {
    const apiKey = this.config.get<string>(provider.keyEnv)!;
    const model = this.config.get<string>(provider.modelEnv) ?? provider.defaultModel;

    const messages: { role: string; content: string }[] = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.user });

    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.4,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty completion');

    return { text, provider: provider.name, model };
  }
}
