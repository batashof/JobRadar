import { cookies } from 'next/headers';

// Server-side fetches go straight to the API (not through the browser proxy),
// forwarding the incoming request's cookies.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

/**
 * Hard ceiling on a single server-side API call. The API runs on a free Render
 * instance (ADR-007) that spins down when idle, so a cold start costs tens of
 * seconds and an unhealthy instance never answers at all. Without a deadline
 * the Vercel function just hangs until the platform kills it, and the user gets
 * a raw `FUNCTION_INVOCATION_TIMEOUT` page instead of anything we control. This
 * sits comfortably under the function limit so *we* time out first.
 */
export const SERVER_API_TIMEOUT_MS = 20_000;

/** The API answered, but not with success. `status` is the HTTP status. */
export class ApiStatusError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`API GET ${path} failed: ${status}`);
    this.name = 'ApiStatusError';
  }
}

/** The API could not be reached at all: timed out, refused, DNS, TLS. */
export class ApiUnavailableError extends Error {
  constructor(
    public readonly path: string,
    public readonly cause?: unknown,
  ) {
    super(`API GET ${path} unreachable`);
    this.name = 'ApiUnavailableError';
  }
}

/** True for the "backend is down" error, which the UI renders as an outage. */
export function isApiUnavailable(error: unknown): error is ApiUnavailableError {
  return error instanceof ApiUnavailableError;
}

/** True when the API answered with the given status. */
export function isApiStatus(error: unknown, status: number): boolean {
  return error instanceof ApiStatusError && error.status === status;
}

/**
 * GET from the API on the server with a deadline, forwarding the session
 * cookie. Throws `ApiUnavailableError` when the API is unreachable and
 * `ApiStatusError` when it answers non-2xx, so callers can tell an outage
 * apart from a real 401/404.
 */
export async function serverApiGet<T>(path: string): Promise<T> {
  const store = await cookies();
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}${path}`, {
      headers: { cookie: store.toString() },
      cache: 'no-store',
      signal: AbortSignal.timeout(SERVER_API_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiUnavailableError(path, error);
  }
  if (!res.ok) throw new ApiStatusError(res.status, path);
  // A handler that returns null/undefined (e.g. "no active plan") sends an empty
  // body — JSON.parse would throw on it, so treat an empty body as null.
  const body = await res.text();
  return (body ? JSON.parse(body) : null) as T;
}
