import { z } from 'zod';

import { EMPLOYMENT_TYPES, type EmploymentType, WORK_FORMATS, type WorkFormat } from './profiles';
import type { SeniorityLevel } from './seniority';

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
  // Hide roles clearly below the active resume's level (ADR-012). A string flag
  // from the query string: only the literal "true"/"1" enables it.
  resumeFit: z.preprocess((v) => v === 'true' || v === true || v === '1', z.boolean().default(false)),
  // Include vacancies the user manually hid; off by default (they stay out of
  // the feed until the "show hidden" toggle is on).
  includeHidden: z.preprocess(
    (v) => v === 'true' || v === true || v === '1',
    z.boolean().default(false),
  ),
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
  /** Coarse level detected at ingestion (ADR-012); null when unstated. */
  seniority?: SeniorityLevel | null;
  /** LLM resume-fit score in [0, 1] for the caller's active resume; null if not yet scored. */
  resumeScore?: number | null;
  /** Short rationale (viewer's language) that accompanies `resumeScore`; null when unscored. */
  resumeExplanation?: string | null;
}

/**
 * Per-criterion resume-fit breakdown (ADR-012). The overall `resumeScore` is a
 * weighted average of these — technologies weigh the most (see resume-match.ts).
 * Order is display order; `note` is localized, `score` is language-neutral.
 */
export const RESUME_MATCH_DIMENSIONS = ['stack', 'role', 'experience', 'location'] as const;
export type ResumeMatchDimensionKey = (typeof RESUME_MATCH_DIMENSIONS)[number];

export interface ResumeMatchDimension {
  key: ResumeMatchDimensionKey;
  /** Per-criterion fit in [0, 1]. */
  score: number;
  /** One-sentence rationale for this criterion, in the viewer's language. */
  note: string;
}

export interface VacancyFeed {
  items: VacancyListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Where to send an application, extracted from the vacancy text (ADR-011). */
export const APPLY_CONTACT_KINDS = ['email', 'telegram', 'url'] as const;
export type ApplyContactKind = (typeof APPLY_CONTACT_KINDS)[number];

export interface ApplyContact {
  kind: ApplyContactKind;
  value: string;
}

/** Full vacancy for the in-app detail page (untruncated description, ADR-011). */
export interface VacancyDetail extends VacancyListItem {
  applyContact: ApplyContact | null;
  /**
   * Cached on-demand brief in the viewer's interface language (ADR-014);
   * null until first generated in that language.
   */
  summary: string | null;
  ingestedAt: string;
  /** Per-criterion resume-fit breakdown in the viewer's language; null when unscored or legacy. */
  resumeBreakdown?: ResumeMatchDimension[] | null;
}

/** POST /vacancies/:id/brief — on-demand brief in the user's language (ADR-011/014). */
export interface BriefResponse {
  /** Brief text in the requested language. */
  summary: string;
  generatedAt: string;
  /** True when served from the cache instead of a fresh LLM call. */
  cached: boolean;
}

/** POST /vacancies/:id/cover-letter — generated from the active resume (ADR-011). */
export interface CoverLetterResponse {
  coverLetter: string;
}

/** POST /vacancies/:id/resume-match — on-demand LLM resume-fit score (ADR-012). */
export interface ResumeMatchResponse {
  /** Overall fit score in [0, 1] — weighted average of `breakdown`. */
  score: number;
  /** Short overall rationale in the requested language. */
  explanation: string;
  /** Per-criterion breakdown; empty for legacy rows scored before this existed. */
  breakdown: ResumeMatchDimension[];
  /** True when served from `resume_matches` instead of a fresh LLM call. */
  cached: boolean;
}

/** A source available as a feed filter option (canonical-vacancy count). */
export interface SourceOption {
  slug: string;
  count: number;
}
