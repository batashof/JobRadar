import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookiesMock = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => cookiesMock() }));

import {
  ApiStatusError,
  ApiUnavailableError,
  SERVER_API_TIMEOUT_MS,
  isApiStatus,
  isApiUnavailable,
  serverApiGet,
} from './server-api';

function mockFetch(impl: () => Promise<unknown>) {
  const fetchMock = vi.fn().mockImplementation(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('serverApiGet', () => {
  beforeEach(() => {
    cookiesMock.mockResolvedValue({ toString: () => 'jr_session=abc' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('forwards the request cookies and parses the JSON body', async () => {
    const fetchMock = mockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"id":"v1"}',
    }));

    await expect(serverApiGet<{ id: string }>('/vacancies/v1')).resolves.toEqual({ id: 'v1' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers.cookie).toBe('jr_session=abc');
  });

  it('treats an empty body as null rather than throwing on JSON.parse', async () => {
    mockFetch(async () => ({ ok: true, status: 200, text: async () => '' }));
    await expect(serverApiGet('/interview/plan')).resolves.toBeNull();
  });

  it('aborts the request on a deadline so the function never hangs', async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, status: 200, text: async () => '{}' }));
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

    await serverApiGet('/vacancies');

    expect(timeoutSpy).toHaveBeenCalledWith(SERVER_API_TIMEOUT_MS);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    timeoutSpy.mockRestore();
  });

  it('throws ApiUnavailableError when the API cannot be reached', async () => {
    mockFetch(async () => {
      throw new DOMException('The operation was aborted', 'TimeoutError');
    });

    const error = await serverApiGet('/vacancies').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiUnavailableError);
    expect(isApiUnavailable(error)).toBe(true);
    expect((error as ApiUnavailableError).path).toBe('/vacancies');
  });

  it('throws ApiStatusError carrying the status when the API answers non-2xx', async () => {
    mockFetch(async () => ({ ok: false, status: 404, text: async () => '' }));

    const error = await serverApiGet('/vacancies/missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiStatusError);
    expect(isApiStatus(error, 404)).toBe(true);
    expect(isApiStatus(error, 500)).toBe(false);
    expect(isApiUnavailable(error)).toBe(false);
  });
});
