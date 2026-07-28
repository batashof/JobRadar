import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';
import { cleanDescription, hasSubstantialDescription } from '../description';

/** Item shape of https://www.workingnomads.com/api/exposed_jobs/ (a flat array). */
export interface WorkingNomadsItem {
  url?: string;
  title?: string;
  description?: string;
  company_name?: string;
  category_name?: string;
  tags?: string;
  location?: string;
  pub_date?: string;
}

/**
 * The exposed feed spans many verticals (Marketing, Sales, …); keep only the
 * dev/tech categories to stay on-topic for an IT job radar.
 */
export const WORKINGNOMADS_TECH_CATEGORIES = new Set(['Development']);

export const isWorkingNomadsJobItem = (item: WorkingNomadsItem): boolean =>
  Boolean(item.url && item.title) &&
  WORKINGNOMADS_TECH_CATEGORIES.has(item.category_name ?? '') &&
  hasSubstantialDescription(item.description);

export function normalizeWorkingNomadsItem(
  item: WorkingNomadsItem,
  sourceId: string,
): NewVacancy {
  const companyRaw = item.company_name?.trim() || 'Unknown';
  const url = item.url ?? '';
  // Their job URLs end in a numeric id (/job/go/1742437/); use it as a stable
  // external id, falling back to the full URL.
  const idMatch = url.match(/(\d+)\/?$/);

  return {
    sourceId,
    externalId: idMatch?.[1] ?? url,
    url,
    title: item.title ?? '',
    companyRaw,
    companyNormalized: normalizeCompanyName(companyRaw),
    description: cleanDescription(item.description),
    // Working Nomads is a remote-only board.
    workFormat: 'remote',
    // The feed carries no structured employment/salary fields.
    employmentType: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    location: item.location?.trim() || null,
    publishedAt: item.pub_date ? new Date(item.pub_date) : null,
  };
}
