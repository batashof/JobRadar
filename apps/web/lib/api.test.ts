import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, ApiError } from './api';

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefixes /api, sends credentials and JSON content-type', async () => {
    const fetchMock = mockFetch({ json: async () => ({ user: { id: '1' } }) });

    const result = await apiFetch<{ user: { id: string } }>('/auth/me');

    expect(result).toEqual({ user: { id: '1' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { credentials: string; headers: Record<string, string> }];
    expect(url).toBe('/api/auth/me');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('returns undefined for 204 responses without parsing a body', async () => {
    mockFetch({ status: 204, json: async () => { throw new Error('no body'); } });
    await expect(apiFetch<void>('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws ApiError with the server message on non-2xx', async () => {
    mockFetch({ ok: false, status: 401, json: async () => ({ message: 'Invalid email or password' }) });

    await expect(apiFetch('/auth/login', { method: 'POST' })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password',
    });
  });

  it('joins zod validation errors into the ApiError message', async () => {
    mockFetch({
      ok: false,
      status: 400,
      json: async () => ({
        message: 'Validation failed',
        errors: [
          { path: 'email', message: 'Enter a valid email' },
          { path: 'password', message: 'Password must be at least 8 characters' },
        ],
      }),
    });

    await expect(apiFetch('/auth/signup', { method: 'POST' })).rejects.toThrow(
      'Enter a valid email, Password must be at least 8 characters',
    );
  });

  it('falls back to a generic message when the body is unparseable', async () => {
    mockFetch({ ok: false, status: 500, json: async () => { throw new Error('boom'); } });

    const error = await apiFetch('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Request failed (500)');
  });
});
