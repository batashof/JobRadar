import type { ProfileCreateInput, ProfileUpdateInput, SearchProfile } from '@jobradar/shared';

import { apiFetch } from './api';

export function listProfiles(): Promise<SearchProfile[]> {
  return apiFetch<SearchProfile[]>('/profiles');
}

export function createProfile(input: ProfileCreateInput): Promise<SearchProfile> {
  return apiFetch<SearchProfile>('/profiles', { method: 'POST', body: JSON.stringify(input) });
}

export function updateProfile(id: string, input: ProfileUpdateInput): Promise<SearchProfile> {
  return apiFetch<SearchProfile>(`/profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteProfile(id: string): Promise<void> {
  return apiFetch<void>(`/profiles/${id}`, { method: 'DELETE' });
}
