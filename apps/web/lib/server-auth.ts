import { SESSION_COOKIE_NAME, type AuthUser } from '@jobradar/shared';
import { cookies } from 'next/headers';

import { ApiUnavailableError, SERVER_API_TIMEOUT_MS } from './server-api';

// Server-only: uses next/headers cookies(), which throws outside a request scope.

// Server-side the web talks to the API directly (not through the browser proxy),
// forwarding the session cookie. Defaults to the local API in development.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

/**
 * Resolves the authenticated user from the session cookie, or null when there
 * is no cookie or the API rejects it.
 *
 * An unreachable API is deliberately *not* null: the caller redirects to
 * /login on null, and bouncing a signed-in user to a login page that is just
 * as broken hides the real problem. Throwing surfaces the outage instead.
 *
 * @throws {ApiUnavailableError} when the API cannot be reached.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(SERVER_API_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiUnavailableError('/auth/me', error);
  }
  if (!res.ok) return null;

  const { user } = (await res.json()) as { user: AuthUser };
  return user;
}
