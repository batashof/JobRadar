import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';

/** Item shape of https://remoteok.com/api (first array element is a legal notice, not a job). */
export interface RemoteOkItem {
  id?: string | number;
  slug?: string;
  date?: string;
  epoch?: number;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number | null;
  salary_max?: number | null;
  url?: string;
  legal?: string;
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

export const isJobItem = (item: RemoteOkItem): boolean =>
  item.id !== undefined && typeof item.position === 'string' && item.position.length > 0;

export function normalizeRemoteOkItem(item: RemoteOkItem, sourceId: string): NewVacancy {
  const companyRaw = item.company?.trim() || 'Unknown';
  const hasSalary = item.salary_min != null || item.salary_max != null;

  return {
    sourceId,
    externalId: String(item.id),
    // Link back to the RemoteOK posting — required by their API terms.
    url: item.url ?? `https://remoteok.com/remote-jobs/${item.slug ?? item.id}`,
    title: item.position ?? '',
    companyRaw,
    companyNormalized: normalizeCompanyName(companyRaw),
    description: item.description ? stripHtml(item.description) : '',
    workFormat: 'remote',
    employmentType: null,
    salaryMin: item.salary_min ?? null,
    salaryMax: item.salary_max ?? null,
    salaryCurrency: hasSalary ? 'USD' : null,
    location: item.location?.trim() || null,
    publishedAt: item.date
      ? new Date(item.date)
      : item.epoch
        ? new Date(item.epoch * 1000)
        : null,
  };
}
