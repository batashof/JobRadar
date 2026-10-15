import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';
import { cleanDescription, hasSubstantialDescription } from '../description';
import { parseSalaryString } from '../salary';

/**
 * DOU.ua and Djinni, the two Ukrainian IT boards, read from their public RSS
 * feeds (roadmap 5.4). Both publish one feed per category or keyword with the
 * full posting HTML in `description`, so no page is ever fetched.
 */

/** DOU categories, exactly as the site spells them in `?category=`. */
export const DEFAULT_DOU_CATEGORIES = [
  'Front End',
  'Node.js',
  'Python',
  'Java',
  '.NET',
  'PHP',
  'QA',
  'DevOps',
  'Golang',
  'iOS/macOS',
  'Android',
  'Data Science',
];

/** Djinni `primary_keyword` values. */
export const DEFAULT_DJINNI_KEYWORDS = [
  'JavaScript',
  'TypeScript',
  'React.js',
  'Node.js',
  'Python',
  'Java',
  '.NET',
  'PHP',
  'QA',
  'DevOps',
  'Golang',
  'iOS',
  'Android',
  'Data Science',
];

/** One `<item>` of either feed, as fast-xml-parser returns it. */
export interface UaRssItem {
  title?: string;
  link?: string;
  guid?: string | { '#text'?: string };
  pubDate?: string;
  description?: string;
  category?: string | string[];
}

const guidText = (guid: UaRssItem['guid']): string | undefined =>
  typeof guid === 'string' ? guid : guid?.['#text'];

/** The posting URL without the feed's `utm_source` tag. */
function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.search = '';
    return url.toString();
  } catch {
    return raw;
  }
}

const date = (raw?: string): Date | null => {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// --------------------------------------------------------------------- DOU

/** "віддалено" (remote) is the one location word DOU puts in the title. */
const DOU_REMOTE_RE = /^(віддалено|удаленно|remote)$/i;
/** A salary part: "$2000–2200", "від $3000", "до €4000". UAH figures are left out. */
const DOU_SALARY_RE = /[$€]/;

/**
 * DOU packs everything into the title:
 * "Middle Frontend Developer (Angular) в Raiffeisen Bank, Київ, віддалено"
 * "Web Developer в Deveit sp. z o.o., $2000–2200, віддалено".
 * The last " в " ("at") separates the role from the rest, whose first part is
 * the company and the others are cities, a salary and the remote marker.
 */
export function splitDouTitle(raw: string): {
  title: string;
  company: string | null;
  cities: string[];
  salary: string | null;
  remote: boolean;
} {
  const text = raw.trim();
  const at = text.lastIndexOf(' в ');
  if (at === -1) return { title: text, company: null, cities: [], salary: null, remote: false };

  const [company = '', ...rest] = text
    .slice(at + 3)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  let salary: string | null = null;
  let remote = false;
  const cities: string[] = [];
  for (const part of rest) {
    if (DOU_REMOTE_RE.test(part)) remote = true;
    else if (DOU_SALARY_RE.test(part)) salary = part;
    else cities.push(part);
  }
  return { title: text.slice(0, at).trim(), company: company || null, cities, salary, remote };
}

/** `https://jobs.dou.ua/companies/<company>/vacancies/<id>/` → `<id>`. */
const DOU_ID_RE = /\/vacancies\/(\d+)/;

export function normalizeDouItem(item: UaRssItem, sourceId: string): NewVacancy | null {
  const link = item.link ?? guidText(item.guid);
  const id = link?.match(DOU_ID_RE)?.[1];
  if (!item.title || !link || !id) return null;
  if (!hasSubstantialDescription(item.description)) return null;

  const parts = splitDouTitle(item.title);
  const company = parts.company ?? 'Unknown';
  const salary = parseSalaryString(parts.salary ?? undefined);

  return {
    sourceId,
    externalId: `dou:${id}`,
    url: cleanUrl(link),
    title: parts.title,
    companyRaw: company,
    companyNormalized: normalizeCompanyName(company),
    description: cleanDescription(item.description),
    // A city with no remote marker may still be hybrid; only "remote" is sure.
    workFormat: parts.remote ? 'remote' : null,
    employmentType: null,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    location: parts.cities.join(', ').slice(0, 120) || null,
    publishedAt: date(item.pubDate),
  };
}

// ------------------------------------------------------------------ Djinni

/** `https://djinni.co/jobs/850653-front-end-developer/` → `850653`. */
const DJINNI_ID_RE = /\/jobs\/(\d+)/;

/**
 * Djinni's feed does not name the employer (the board lets companies stay
 * anonymous until a candidate applies). The card says so, and the normalized
 * company is `unknown`, which deduplication never matches on: two different
 * anonymous "Frontend Developer" postings must not be merged as one.
 */
export const DJINNI_COMPANY = 'Company on Djinni';

export function normalizeDjinniItem(item: UaRssItem, sourceId: string): NewVacancy | null {
  const link = item.link ?? guidText(item.guid);
  const id = link?.match(DJINNI_ID_RE)?.[1];
  if (!item.title || !link || !id) return null;
  if (!hasSubstantialDescription(item.description)) return null;

  return {
    sourceId,
    externalId: `djinni:${id}`,
    url: cleanUrl(link),
    title: item.title.trim(),
    companyRaw: DJINNI_COMPANY,
    companyNormalized: 'unknown',
    description: cleanDescription(item.description),
    workFormat: null,
    employmentType: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    location: null,
    publishedAt: date(item.pubDate),
  };
}
