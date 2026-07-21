import { cookies } from 'next/headers';

// Server-side fetches go straight to the API (not through the browser proxy),
// forwarding the incoming request's cookies.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

/** GET a JSON resource from the API on the server, forwarding the session cookie. */
export async function serverApiGet<T>(path: string): Promise<T> {
  const store = await cookies();
  const res = await fetch(`${API_ORIGIN}${path}`, {
    headers: { cookie: store.toString() },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API GET ${path} failed: ${res.status}`);
  // A handler that returns null/undefined (e.g. "no active plan") sends an empty
  // body — JSON.parse would throw on it, so treat an empty body as null.
  const body = await res.text();
  return (body ? JSON.parse(body) : null) as T;
}
