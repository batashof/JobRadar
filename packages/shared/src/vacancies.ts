import { z } from 'zod';

import { EMPLOYMENT_TYPES, type EmploymentType, WORK_FORMATS, type WorkFormat } from './profiles';

/**
 * Vacancy feed contracts. The query schema coerces raw query-string values
 * (strings, repeated params, comma-joined lists) into typed filters.
 */

const csvEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) =>
      v == null || v === ''
        ? []
        : Array.isArray(v)
          ? v
          : String(v)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
    z.array(z.enum(values)).default([]),
  );

export const VACANCY_PAGE_SIZE_DEFAULT = 20;
export const VACANCY_PAGE_SIZE_MAX = 50;

export const vacancyQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  workFormat: csvEnum(WORK_FORMATS),
  employmentType: csvEnum(EMPLOYMENT_TYPES),
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
