import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';
import { cleanDescription, hasSubstantialDescription } from '../description';
import { parseSalaryString } from '../salary';

/**
 * "Ask HN: Who is hiring?" — the monthly thread whose top-level comments are
 * job posts (docs/DATA_SOURCES.md). Posts are free-form prose, but the
 * community convention is a pipe-delimited header line:
 *
 *   `Company | Role | Location | REMOTE | Full-time | $180k-$230k`
 *
 * Segments are optional and their order varies, so every field is matched by
 * what it *looks like* rather than by position. Nothing is guessed: a field
 * that cannot be recognised stays null (the normalization contract).
 */

/** A comment as returned by the Algolia HN search API. */
export interface HnComment {
  objectID?: string;
  parent_id?: number;
  story_id?: number;
  author?: string;
  comment_text?: string;
  created_at?: string;
}

/** The header is the first paragraph; HN separates them with `<p>`. */
export function extractHeader(commentText: string): string {
  const firstParagraph = commentText.split(/<p>/i)[0] ?? '';
  return cleanDescription(firstParagraph).replace(/[*_`]/g, '').trim();
}

const splitHeader = (header: string): string[] =>
  header
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const ROLE_RE =
  /(engineer|developer|programmer|architect|scientist|analyst|designer|devops|sre|sysadmin|administrator|manager|lead|head\s+of|director|cto|founding|intern|consultant|specialist|researcher|technologist|full[\s-]?stack|front[\s-]?end|back[\s-]?end)/i;
const WORK_FORMAT_RE = /remote|onsite|on-site|hybrid|wfh|distributed/i;
const EMPLOYMENT_RE = /full[\s-]?time|part[\s-]?time|contract|freelance|intern(ship)?|permanent|part-or-full/i;
const SALARY_RE = /[$€£]\s*\d|\d+\s*k\b|equity/i;
const LOCATION_RE =
  /remote|onsite|on-site|hybrid|anywhere|worldwide|europe|emea|americas|apac|usa|u\.s\.|uk|[A-Z][a-z]+,\s*[A-Z]{2}\b/i;

/**
 * The role segment: the first one that reads like a job title. The convention
 * puts it second, so that is the fallback — but only when it is not obviously
 * something else, since some posts name no role in the header at all ("Acme |
 * REMOTE (US) | Full-time | 70k - 90k"). Those return '' and are dropped: a
 * card titled "REMOTE (US)" is worse than one missing post.
 */
export function extractTitle(segments: string[]): string {
  const role = segments.find((s) => ROLE_RE.test(s) && !SALARY_RE.test(s));
  if (role) return role.slice(0, 200);

  const second = segments[1];
  if (!second) return '';
  const looksLikeMetadata =
    WORK_FORMAT_RE.test(second) || EMPLOYMENT_RE.test(second) || SALARY_RE.test(second);
  return looksLikeMetadata ? '' : second.slice(0, 200);
}

/**
 * The company is the leading segment — unless that segment is itself the role
 * (posts that lead with the job title), in which case the post names no company
 * in its header and we do not invent one.
 */
export function extractCompany(segments: string[]): string | null {
  const first = segments[0];
  if (!first) return null;
  if (first === extractTitle(segments)) return null;
  if (WORK_FORMAT_RE.test(first) || EMPLOYMENT_RE.test(first) || SALARY_RE.test(first)) return null;
  // Posts often put a URL next to the name: "Chronograph (chronograph.pe)".
  return first.replace(/\s*\([^)]*\.[a-z]{2,}[^)]*\)\s*/gi, ' ').trim().slice(0, 120) || null;
}

export function extractWorkFormat(header: string): NewVacancy['workFormat'] {
  // "REMOTE or ONSITE" and "Hybrid (2 days remote)" both offer remote work,
  // so remote wins over the more restrictive formats when several are named.
  if (/\bremote\b|\bwfh\b|distributed/i.test(header)) return 'remote';
  if (/hybrid/i.test(header)) return 'hybrid';
  if (/\bonsite\b|\bon-site\b/i.test(header)) return 'onsite';
  return null;
}

export function extractEmploymentType(header: string): NewVacancy['employmentType'] {
  // Order matters: "part-or-full-time" is an offer of both (record the fuller
  // one), while "part-time, path to full-time" starts part-time. Matching on
  // "full time" rather than a bare "full" keeps "Full Stack Developer" out.
  if (/part[\s-]?or[\s-]?full/i.test(header)) return 'full_time';
  if (/part[\s-]?time/i.test(header)) return 'part_time';
  if (/full[\s-]?time|permanent/i.test(header)) return 'full_time';
  if (/contract|freelance|contractor/i.test(header)) return 'freelance';
  return null;
}

export function extractLocation(segments: string[]): string | null {
  const title = extractTitle(segments);
  const match = segments.find(
    (s) => s !== title && LOCATION_RE.test(s) && !EMPLOYMENT_RE.test(s) && !SALARY_RE.test(s),
  );
  return match?.slice(0, 120) ?? null;
}

export function extractSalary(segments: string[]): ReturnType<typeof parseSalaryString> {
  const segment = segments.find((s) => SALARY_RE.test(s));
  return parseSalaryString(segment);
}

/**
 * Only top-level comments are job posts — replies are questions and follow-ups.
 * The description gate (ADR-016) drops the "s/o to the mods" one-liners.
 */
export const isHnJobComment = (comment: HnComment, storyId: number): boolean =>
  Boolean(comment.objectID) &&
  comment.parent_id === storyId &&
  hasSubstantialDescription(comment.comment_text);

/**
 * Returns null for posts that offer no remote work: JobRadar is a remote-work
 * radar, and the thread is dominated by single-city onsite roles.
 */
export function normalizeHnComment(comment: HnComment, sourceId: string): NewVacancy | null {
  const header = extractHeader(comment.comment_text ?? '');
  const segments = splitHeader(header);
  const title = extractTitle(segments);
  if (!title) return null;

  const workFormat = extractWorkFormat(header);
  if (workFormat !== 'remote' && workFormat !== 'hybrid') return null;

  const companyRaw = extractCompany(segments) ?? 'Unknown';
  const salary = extractSalary(segments);

  return {
    sourceId,
    externalId: `hn:${comment.objectID}`,
    url: `https://news.ycombinator.com/item?id=${comment.objectID}`,
    title,
    companyRaw,
    companyNormalized: normalizeCompanyName(companyRaw),
    description: cleanDescription(comment.comment_text),
    workFormat,
    employmentType: extractEmploymentType(header),
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    location: extractLocation(segments),
    publishedAt: comment.created_at ? new Date(comment.created_at) : null,
  };
}
