import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';
import { cleanDescription, hasSubstantialDescription } from '../description';

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
 * Remotive salaries are free-form strings ("$150k - $230k", "$36k",
 * "$120 - $170 /hour"). We only map clear *annual* figures — hourly rates and
 * unparseable strings stay null rather than polluting the salary filters.
 */
export function parseRemotiveSalary(raw?: string): {
  min: number | null;
  max: number | null;
  currency: string | null;
} {
  const none = { min: null, max: null, currency: null };
  if (!raw) return none;
  const s = raw.trim();
  if (!s || /\/\s*(hour|hr)\b|per\s+hour/i.test(s)) return none;

  const currency = /\$|usd/i.test(s)
    ? 'USD'
    : /€|eur/i.test(s)
      ? 'EUR'
      : /£|gbp/i.test(s)
        ? 'GBP'
        : null;

  const nums: number[] = [];
  const re = /([\d][\d.,]*)\s*(k)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const digits = m[1];
    if (!digits) continue;
    let n = Number.parseFloat(digits.replace(/,/g, ''));
    if (Number.isNaN(n)) continue;
    if (m[2]) n *= 1000;
    else if (n < 1000) continue; // ignore stray small numbers (page counts, etc.)
    nums.push(n);
  }
  if (nums.length === 0) return none;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max: max === min ? null : max, currency: currency ?? 'USD' };
}

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
