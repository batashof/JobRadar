import { SESSION_COOKIE_NAME, type AuthUser } from '@jobradar/shared';
import { cookies } from 'next/headers';

// Server-only: uses next/headers cookies(), which throws outside a request scope.

// Server-side the web talks to the API directly (not through the browser proxy),
// forwarding the session cookie. Defaults to the local API in development.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

/** Resolves the authenticated user from the session cookie, or null. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const res = await fetch(`${API_ORIGIN}/auth/me`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;

  const { user } = (await res.json()) as { user: AuthUser };
  return user;
}
