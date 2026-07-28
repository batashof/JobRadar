import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';
import { cleanDescription, hasSubstantialDescription } from '../description';
import { parseSalaryString } from '../salary';

/** Item shape of https://remotive.com/api/remote-jobs (payload under `jobs`). */
export interface RemotiveItem {
  id?: number;
  url?: string;
  title?: string;
  company_name?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

/**
 * Remotive's `category=software-dev` filter is unreliable (the feed still mixes
 * in Medical/Sales items), so we keep only tech categories client-side.
 */
export const REMOTIVE_TECH_CATEGORIES = new Set([
  'Software Development',
  'Devops',
  'DevOps / Sysadmin',
  'Data and Analytics',
  'Artificial Intelligence',
  'Quality Assurance',
  'Information Technology',
]);

const EMPLOYMENT_MAP: Record<string, NewVacancy['employmentType'] & string> = {
  full_time: 'full_time',
  part_time: 'part_time',
  // Our enum has no dedicated "contract"; both fold into freelance.
  contract: 'freelance',
  freelance: 'freelance',
};

/**
 * Remotive publishes salary as a free-form string; the parsing rules are shared
 * with the other prose-salary sources (see `ingestion/salary.ts`).
 */
export const parseRemotiveSalary = parseSalaryString;

export const isRemotiveJobItem = (item: RemotiveItem): boolean =>
  item.id !== undefined &&
  typeof item.title === 'string' &&
  item.title.length > 0 &&
  REMOTIVE_TECH_CATEGORIES.has(item.category ?? '') &&
  hasSubstantialDescription(item.description);

export function normalizeRemotiveItem(item: RemotiveItem, sourceId: string): NewVacancy {
  const companyRaw = item.company_name?.trim() || 'Unknown';
  const salary = parseRemotiveSalary(item.salary);

  return {
    sourceId,
    externalId: String(item.id),
    url: item.url ?? '',
    title: item.title ?? '',
    companyRaw,
    companyNormalized: normalizeCompanyName(companyRaw),
    description: cleanDescription(item.description),
    // Remotive is a remote-only board.
    workFormat: 'remote',
    employmentType: (item.job_type && EMPLOYMENT_MAP[item.job_type]) || null,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    location: item.candidate_required_location?.trim() || null,
    publishedAt: item.publication_date ? new Date(item.publication_date) : null,
  };
}
