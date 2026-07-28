import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';
import { cleanDescription, hasSubstantialDescription } from '../description';

/** Item shape of https://himalayas.app/jobs/api (payload under `jobs`). */
export interface HimalayasItem {
  title?: string;
  excerpt?: string;
  companyName?: string;
  companySlug?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string | null;
  seniority?: string[];
  locationRestrictions?: string[];
  categories?: string[];
  parentCategories?: string[];
  description?: string;
  pubDate?: number;
  applicationLink?: string;
  guid?: string;
}

/**
 * The feed spans every vertical (healthcare dominates the newest pages), so
 * tech items have to be picked out client-side. `parentCategories` is the clean
 * signal but is only set on about a third of the items; the rest fall back to
 * the free-form `categories` tags.
 */
export const HIMALAYAS_TECH_PARENT_CATEGORIES = new Set([
  'Developer',
  'Data Science',
  'DevOps',
  'Security',
  'QA',
  'Hardware Engineer',
]);

const TECH_CATEGORY_RE =
  /(software|engineer|developer|devops|sre|site-reliability|backend|back-end|frontend|front-end|fullstack|full-stack|programming|data-engineering|machine-learning|\bai-|analytics-engineering|qa-|quality-assurance|test-automation|sysadmin|cloud|kubernetes|platform-engineering|security-engineer|infosec|mobile-develop|ios-|android-|web-develop|python|javascript|typescript|react|node|java-|golang|rust|php|ruby|\.net|blockchain)/i;

export const isHimalayasJobItem = (item: HimalayasItem): boolean => {
  if (!item.title || !(item.guid ?? item.applicationLink)) return false;
  if (!hasSubstantialDescription(item.description ?? item.excerpt)) return false;

  const parents = item.parentCategories ?? [];
  if (parents.length > 0) {
    return parents.some((c) => HIMALAYAS_TECH_PARENT_CATEGORIES.has(c));
  }
  return (item.categories ?? []).some((c) => TECH_CATEGORY_RE.test(c));
};

const EMPLOYMENT_MAP: Record<string, NewVacancy['employmentType'] & string> = {
  'full time': 'full_time',
  'part time': 'part_time',
  contract: 'freelance',
  freelance: 'freelance',
  contractor: 'freelance',
};

export function mapHimalayasEmployment(raw?: string): NewVacancy['employmentType'] {
  return (raw && EMPLOYMENT_MAP[raw.trim().toLowerCase()]) || null;
}

/**
 * Salary is structured but the period varies. Only annual figures land in the
 * salary filters — hourly/monthly rates would compare against yearly numbers
 * from every other board and skew the whole feed.
 */
export function parseHimalayasSalary(item: HimalayasItem): {
  min: number | null;
  max: number | null;
  currency: string | null;
} {
  const none = { min: null, max: null, currency: null };
  if ((item.salaryPeriod ?? '').toLowerCase() !== 'annual') return none;
  const min = typeof item.minSalary === 'number' ? Math.round(item.minSalary) : null;
  const max = typeof item.maxSalary === 'number' ? Math.round(item.maxSalary) : null;
  if (min === null && max === null) return none;
  return { min, max, currency: item.currency ?? 'USD' };
}

export function normalizeHimalayasItem(item: HimalayasItem, sourceId: string): NewVacancy {
  const companyRaw = item.companyName?.trim() || 'Unknown';
  const url = item.applicationLink ?? item.guid ?? '';
  const salary = parseHimalayasSalary(item);

  return {
    sourceId,
    // The guid is the canonical posting permalink and stays stable across runs.
    externalId: item.guid ?? url,
    url,
    title: item.title ?? '',
    companyRaw,
    companyNormalized: normalizeCompanyName(companyRaw),
    description: cleanDescription(item.description ?? item.excerpt),
    // Himalayas is a remote-only board.
    workFormat: 'remote',
    employmentType: mapHimalayasEmployment(item.employmentType),
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    location: item.locationRestrictions?.join(', ').trim() || null,
    // `pubDate` is a Unix timestamp in seconds.
    publishedAt: item.pubDate ? new Date(item.pubDate * 1000) : null,
  };
}
