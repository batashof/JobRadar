/** Thrown for any non-2xx API response. `details` carries the parsed error body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorBody {
  message?: string | string[];
  errors?: { path: string; message: string }[];
}

function messageFrom(body: ApiErrorBody | null, status: number): string {
  if (body?.errors?.length) return body.errors.map((e) => e.message).join(', ');
  if (Array.isArray(body?.message)) return body.message.join(', ');
  if (typeof body?.message === 'string') return body.message;
  return `Request failed (${status})`;
}

/**
 * Calls the NestJS API through the same-origin `/api` proxy (Next rewrites).
 * `credentials: include` sends the session cookie. Returns parsed JSON, or
 * `undefined` for 204 responses.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new ApiError(res.status, messageFrom(body as ApiErrorBody | null, res.status), body);
  }
  return body as T;
}
