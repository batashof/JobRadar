import type { vacancies } from '../../db/schema';
import { normalizeCompanyName } from '../company-name';

/** Subset of the hh.ru vacancy-search item we consume (https://api.hh.ru/vacancies). */
export interface HhVacancyItem {
  id: string;
  name: string;
  alternate_url: string;
  employer?: { name?: string | null } | null;
  snippet?: { requirement?: string | null; responsibility?: string | null } | null;
  schedule?: { id?: string | null } | null;
  employment?: { id?: string | null } | null;
  salary?: { from?: number | null; to?: number | null; currency?: string | null } | null;
  area?: { name?: string | null } | null;
  published_at?: string;
}

export type NewVacancy = typeof vacancies.$inferInsert;

const EMPLOYMENT_MAP: Record<string, NewVacancy['employmentType'] & string> = {
  full: 'full_time',
  part: 'part_time',
  project: 'freelance',
};

/** hh returns <highlighttext> markers in snippets; strip all tags. */
const stripTags = (value: string): string => value.replace(/<[^>]+>/g, '');

export function normalizeHhItem(item: HhVacancyItem, sourceId: string): NewVacancy {
  const companyRaw = item.employer?.name?.trim() || 'Unknown';
  const description = [item.snippet?.requirement, item.snippet?.responsibility]
    .filter((part): part is string => Boolean(part))
    .map(stripTags)
    .join('\n');

  return {
    sourceId,
    externalId: String(item.id),
    url: item.alternate_url,
    title: item.name,
    companyRaw,
    companyNormalized: normalizeCompanyName(companyRaw),
    description,
    // hh has no explicit hybrid/onsite marker in search items — only remote is reliable.
    workFormat: item.schedule?.id === 'remote' ? 'remote' : null,
    employmentType: (item.employment?.id && EMPLOYMENT_MAP[item.employment.id]) || null,
    salaryMin: item.salary?.from ?? null,
    salaryMax: item.salary?.to ?? null,
    salaryCurrency: item.salary?.currency === 'RUR' ? 'RUB' : (item.salary?.currency ?? null),
    location: item.area?.name ?? null,
    publishedAt: item.published_at ? new Date(item.published_at) : null,
  };
}
