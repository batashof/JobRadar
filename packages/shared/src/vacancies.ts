import { z } from 'zod';

import { EMPLOYMENT_TYPES, type EmploymentType, WORK_FORMATS, type WorkFormat } from './profiles';

/**
 * Vacancy feed contracts. The query schema coerces raw query-string values
 * (strings, repeated params, comma-joined lists) into typed filters.
 */

const splitCsv = (v: unknown): unknown =>
  v == null || v === ''
    ? []
    : Array.isArray(v)
      ? v
      : String(v)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

const csvEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(splitCsv, z.array(z.enum(values)).default([]));

// Source slugs are DB-driven (not a closed enum) — validate shape, not membership.
const csvSlugs = z.preprocess(
  splitCsv,
  z.array(z.string().regex(/^[a-z0-9_-]{1,50}$/)).max(20).default([]),
);

export const VACANCY_PAGE_SIZE_DEFAULT = 20;
export const VACANCY_PAGE_SIZE_MAX = 50;

export const vacancyQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  workFormat: csvEnum(WORK_FORMATS),
  employmentType: csvEnum(EMPLOYMENT_TYPES),
  sources: csvSlugs,
  salaryMin: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(VACANCY_PAGE_SIZE_MAX)
    .default(VACANCY_PAGE_SIZE_DEFAULT),
});

export type VacancyQuery = z.infer<typeof vacancyQuerySchema>;

/** A vacancy as serialized in the feed (description truncated, timestamps ISO). */
export interface VacancyListItem {
  id: string;
  url: string;
  title: string;
  company: string;
  description: string;
  source: string;
  workFormat: WorkFormat | null;
  employmentType: EmploymentType | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  location: string | null;
  publishedAt: string | null;
}

export interface VacancyFeed {
  items: VacancyListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** A source available as a feed filter option (canonical-vacancy count). */
export interface SourceOption {
  slug: string;
  count: number;
}
