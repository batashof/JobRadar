import { SESSION_COOKIE_NAME } from '@jobradar/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookiesMock = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => cookiesMock() }));

import { ApiUnavailableError } from './server-api';
import { getCurrentUser } from './server-auth';

function withCookie(token: string | undefined) {
  cookiesMock.mockResolvedValue({
    get: (name: string) => (name === SESSION_COOKIE_NAME && token ? { value: token } : undefined),
  });
}

describe('getCurrentUser', () => {
  beforeEach(() => withCookie('token-1'));
  afterEach(() => vi.unstubAllGlobals());

  it('returns null without a session cookie, without calling the API', async () => {
    withCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the user for a valid session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: { id: 'u1', language: 'ru' } }) }),
    );

    await expect(getCurrentUser()).resolves.toEqual({ id: 'u1', language: 'ru' });
  });

  it('returns null when the API rejects the cookie', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('throws instead of returning null when the API is unreachable', async () => {
    // Null would send a signed-in user to a login page that is equally broken,
    // hiding the outage — the boundary must see the failure.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('aborted', 'TimeoutError')),
    );

    await expect(getCurrentUser()).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
