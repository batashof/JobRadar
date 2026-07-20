import type { MatchFeed, MatchProfileOption } from '@jobradar/shared';

import { apiFetch } from './api';

export function fetchMatches(
  profileId: string | null,
  page: number,
  pageSize = 20,
): Promise<MatchFeed> {
  const params = new URLSearchParams();
  if (profileId) params.set('profileId', profileId);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return apiFetch<MatchFeed>(`/matches?${params.toString()}`);
}

export function fetchMatchProfiles(): Promise<MatchProfileOption[]> {
  return apiFetch<MatchProfileOption[]>('/matches/profiles');
}
