import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';
import { cleanDescription, hasSubstantialDescription } from '../description';

/** RSS item shape of weworkremotely.com category feeds. */
export interface WwrRssItem {
  title?: string;
  link?: string;
  guid?: string | { '#text'?: string };
  pubDate?: string;
  description?: string;
  region?: string;
  category?: string;
  type?: string;
}

/** WWR packs "Company: Job Title" into one string; split on the first colon. */
export function splitWwrTitle(raw: string): { company: string; title: string } {
  const idx = raw.indexOf(':');
  if (idx === -1) return { company: 'Unknown', title: raw.trim() };
  return {
    company: raw.slice(0, idx).trim() || 'Unknown',
    title: raw.slice(idx + 1).trim() || raw.trim(),
  };
}

const guidText = (guid: WwrRssItem['guid']): string | undefined =>
  typeof guid === 'string' ? guid : guid?.['#text'];

export const isWwrJobItem = (item: WwrRssItem): boolean =>
  Boolean(item.title && (guidText(item.guid) ?? item.link)) &&
  hasSubstantialDescription(item.description);

export function normalizeWwrItem(item: WwrRssItem, sourceId: string): NewVacancy {
  const { company, title } = splitWwrTitle(item.title ?? '');
  const url = item.link ?? guidText(item.guid) ?? '';
  const employmentType = item.type?.toLowerCase().includes('full')
    ? ('full_time' as const)
    : null;

  return {
    sourceId,
    // The guid permalink is stable; fall back to the link.
    externalId: guidText(item.guid) ?? url,
    url,
    title,
    companyRaw: company,
    companyNormalized: normalizeCompanyName(company),
    description: cleanDescription(item.description),
    workFormat: 'remote',
    employmentType,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    location: item.region?.trim() || null,
    publishedAt: item.pubDate ? new Date(item.pubDate) : null,
  };
}
