import { z } from 'zod';

import type { VacancyListItem } from './vacancies';
import { VACANCY_PAGE_SIZE_DEFAULT, VACANCY_PAGE_SIZE_MAX } from './vacancies';

/**
 * Profile-match contracts. Matches are materialized rows in `profile_matches`
 * (rules-based score in v1); the API serves them per user, optionally narrowed
 * to a single profile.
 */

export const matchQuerySchema = z.object({
  profileId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(VACANCY_PAGE_SIZE_MAX)
    .default(VACANCY_PAGE_SIZE_DEFAULT),
});

export type MatchQuery = z.infer<typeof matchQuerySchema>;

/** A matched vacancy as served by GET /matches (score in [0, 1]). */
export interface MatchListItem {
  vacancy: VacancyListItem;
  profileId: string;
  profileName: string;
  score: number;
  matchedAt: string;
}

export interface MatchFeed {
  items: MatchListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** A profile as a match-filter option (with its current match count). */
export interface MatchProfileOption {
  id: string;
  name: string;
  isActive: boolean;
  count: number;
}
