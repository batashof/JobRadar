import type { AuthResponse, LoginInput, SignupInput } from '@jobradar/shared';

import { apiFetch, ApiError } from './api';

export async function signup(input: SignupInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
}

/** Resolves the current user, or null if the session is missing/expired. */
export async function fetchMe(): Promise<AuthResponse['user'] | null> {
  try {
    const { user } = await apiFetch<AuthResponse>('/auth/me');
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
