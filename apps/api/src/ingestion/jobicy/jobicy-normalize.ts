import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';

/** Item shape of https://jobicy.com/api/v2/remote-jobs (payload under `jobs`). */
export interface JobicyItem {
  id?: number;
  url?: string;
  jobSlug?: string;
  jobTitle?: string;
  companyName?: string;
  jobIndustry?: string[];
  jobType?: string[];
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
}

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Jobicy's jobType is an array of labels like "Full-Time" / "Freelance". */
export function mapJobicyEmployment(types?: string[]): NewVacancy['employmentType'] {
  const t = types?.[0]?.toLowerCase() ?? '';
  if (t.includes('full')) return 'full_time';
  if (t.includes('part')) return 'part_time';
  if (t.includes('contract') || t.includes('freelance')) return 'freelance';
  return null;
}

export const isJobicyJobItem = (item: JobicyItem): boolean =>
  item.id !== undefined && typeof item.jobTitle === 'string' && item.jobTitle.length > 0;

export function normalizeJobicyItem(item: JobicyItem, sourceId: string): NewVacancy {
  const companyRaw = item.companyName?.trim() || 'Unknown';
  const rawDescription = item.jobDescription || item.jobExcerpt || '';

  return {
    sourceId,
    externalId: String(item.id),
    url: item.url ?? '',
    title: item.jobTitle ?? '',
    companyRaw,
    companyNormalized: normalizeCompanyName(companyRaw),
    description: rawDescription ? stripHtml(rawDescription) : '',
    // Jobicy is a remote-only board.
    workFormat: 'remote',
    employmentType: mapJobicyEmployment(item.jobType),
    // The public v2 feed carries no structured salary fields.
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    location: item.jobGeo?.trim() || null,
    publishedAt: item.pubDate ? new Date(item.pubDate) : null,
  };
}
