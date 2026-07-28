import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';
import { cleanDescription, hasSubstantialDescription } from '../description';
import { parseSalaryString } from '../salary';

/**
 * Company career pages, read straight from their applicant tracking system.
 *
 * This is the highest-quality data in the pipeline — it comes from the employer
 * rather than an aggregator, so there is no boilerplate, no scraped page and no
 * stale reposting. The cost is that the company list is curated rather than
 * discovered (see `sources.config.companies`).
 *
 * Every board mixes engineering with sales/HR/support and remote with onsite,
 * so both filters are applied per adapter using whatever signal that ATS
 * actually publishes.
 */

export type AtsKind = 'greenhouse' | 'ashby' | 'lever';

export interface AtsCompany {
  ats: AtsKind;
  /** Board identifier in the ATS URL, e.g. `gitlab` or `Supabase`. */
  token: string;
  /** Display name — Ashby and Lever do not publish one. */
  name: string;
}

const TECH_RE =
  /(engineer|developer|programmer|architect|devops|\bsre\b|reliability|backend|back-end|frontend|front-end|full[\s-]?stack|software|data\s|machine learning|\bml\b|\bai\b|security|infrastructure|platform|mobile|\bios\b|android|\bqa\b|quality assurance|sdet|technical)/i;

const REMOTE_LOCATION_RE = /remote|anywhere|distributed|\bglobal\b/i;

/** True when any of the free-text fields reads like an engineering role. */
const isTechRole = (...fields: Array<string | undefined>): boolean =>
  fields.some((field) => field && TECH_RE.test(field));

// ---------------------------------------------------------------- Greenhouse

/** `https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true` */
export interface GreenhouseJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  company_name?: string;
  location?: { name?: string };
  departments?: Array<{ name?: string }>;
  content?: string;
  updated_at?: string;
  first_published?: string;
}

export function normalizeGreenhouseJob(
  job: GreenhouseJob,
  company: AtsCompany,
  sourceId: string,
): NewVacancy | null {
  const location = job.location?.name ?? '';
  // Greenhouse publishes no structured remote flag — the location string is
  // the only signal, and boards do write "Remote, Germany" into it.
  if (!REMOTE_LOCATION_RE.test(location)) return null;
  if (!job.id || !job.title) return null;
  if (!isTechRole(job.title, ...(job.departments ?? []).map((d) => d.name))) return null;
  // `content` is HTML entity-encoded twice; cleanDescription handles that.
  if (!hasSubstantialDescription(job.content)) return null;

  const companyRaw = job.company_name?.trim() || company.name;

  return {
    sourceId,
    externalId: `greenhouse:${company.token}:${job.id}`,
    url: job.absolute_url ?? '',
    title: job.title,
    companyRaw,
    companyNormalized: normalizeCompanyName(companyRaw),
    description: cleanDescription(job.content),
    workFormat: 'remote',
    // Greenhouse boards carry neither employment type nor salary.
    employmentType: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    location: location.slice(0, 120),
    publishedAt: job.first_published
      ? new Date(job.first_published)
      : job.updated_at
        ? new Date(job.updated_at)
        : null,
  };
}

// --------------------------------------------------------------------- Ashby

/** `https://api.ashbyhq.com/posting-api/job-board/<token>?includeCompensation=true` */
export interface AshbyJob {
  id?: string;
  title?: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  workplaceType?: string;
  isRemote?: boolean;
  isListed?: boolean;
  publishedAt?: string;
  jobUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: { compensationTierSummary?: string | null };
}

const ASHBY_EMPLOYMENT: Record<string, NewVacancy['employmentType'] & string> = {
  fulltime: 'full_time',
  parttime: 'part_time',
  contract: 'freelance',
  temporary: 'freelance',
};

export function mapAshbyEmployment(raw?: string): NewVacancy['employmentType'] {
  return (raw && ASHBY_EMPLOYMENT[raw.trim().toLowerCase()]) || null;
}

export function normalizeAshbyJob(
  job: AshbyJob,
  company: AtsCompany,
  sourceId: string,
): NewVacancy | null {
  if (!job.id || !job.title || job.isListed === false) return null;

  // `isRemote` is not usable: boards set it on hybrid roles too (OpenAI reports
  // 475 "remote" postings of which 446 are workplaceType Hybrid). Only
  // `workplaceType` is honest; when it is absent, fall back to the location.
  const workplaceType = job.workplaceType?.toLowerCase();
  const isRemote =
    workplaceType === 'remote' || (!workplaceType && REMOTE_LOCATION_RE.test(job.location ?? ''));
  if (!isRemote) return null;

  if (!isTechRole(job.title, job.department, job.team)) return null;
  const rawDescription = job.descriptionHtml || job.descriptionPlain;
  if (!hasSubstantialDescription(rawDescription)) return null;

  // "$213K – $251K • Offers Equity • …" — only the leading range is a salary.
  const salary = parseSalaryString(job.compensation?.compensationTierSummary?.split('•')[0]);

  return {
    sourceId,
    externalId: `ashby:${company.token}:${job.id}`,
    url: job.jobUrl ?? '',
    title: job.title,
    companyRaw: company.name,
    companyNormalized: normalizeCompanyName(company.name),
    description: cleanDescription(rawDescription),
    workFormat: 'remote',
    employmentType: mapAshbyEmployment(job.employmentType),
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    location: job.location?.trim().slice(0, 120) || null,
    publishedAt: job.publishedAt ? new Date(job.publishedAt) : null,
  };
}

// --------------------------------------------------------------------- Lever

/** `https://api.lever.co/v0/postings/<token>?mode=json` */
export interface LeverJob {
  id?: string;
  text?: string;
  hostedUrl?: string;
  workplaceType?: string;
  country?: string;
  createdAt?: number;
  descriptionPlain?: string;
  description?: string;
  categories?: {
    team?: string;
    department?: string;
    location?: string;
    commitment?: string;
  };
}

export function mapLeverEmployment(raw?: string): NewVacancy['employmentType'] {
  const value = raw?.toLowerCase() ?? '';
  if (value.includes('part')) return 'part_time';
  if (value.includes('contract') || value.includes('temporary') || value.includes('short term')) {
    return 'freelance';
  }
  if (value.includes('full') || value.includes('permanent')) return 'full_time';
  return null;
}

export function normalizeLeverJob(
  job: LeverJob,
  company: AtsCompany,
  sourceId: string,
): NewVacancy | null {
  if (!job.id || !job.text) return null;
  if (job.workplaceType?.toLowerCase() !== 'remote') return null;
  if (!isTechRole(job.text, job.categories?.team, job.categories?.department)) return null;

  const rawDescription = job.description || job.descriptionPlain;
  if (!hasSubstantialDescription(rawDescription)) return null;

  return {
    sourceId,
    externalId: `lever:${company.token}:${job.id}`,
    url: job.hostedUrl ?? '',
    title: job.text,
    companyRaw: company.name,
    companyNormalized: normalizeCompanyName(company.name),
    description: cleanDescription(rawDescription),
    workFormat: 'remote',
    employmentType: mapLeverEmployment(job.categories?.commitment),
    // Lever exposes a salaryRange only for boards that opt in; none of the
    // configured ones do, so the field is not read.
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    location: job.categories?.location?.trim().slice(0, 120) || job.country?.trim() || null,
    // `createdAt` is a Unix timestamp in milliseconds.
    publishedAt: job.createdAt ? new Date(job.createdAt) : null,
  };
}
