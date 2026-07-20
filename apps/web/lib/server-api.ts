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
  return res.json() as Promise<T>;
}
