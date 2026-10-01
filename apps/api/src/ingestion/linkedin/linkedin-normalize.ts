import type { NewVacancy } from '../hh/hh-normalize';
import { normalizeCompanyName } from '../company-name';
import { parseSalaryString } from '../salary';
import type { LinkedInAlertJob } from './linkedin-alert-parse';

export interface AlertContext {
  sourceId: string;
  /** When the alert email arrived — the best publication date the card offers. */
  receivedAt: Date | null;
  /** The saved search that produced the email, when the email names it. */
  alertQuery: string | null;
}

/** "Berlin, Germany (Remote)" — LinkedIn appends the workplace type in parentheses. */
const WORKPLACE_SUFFIX_RE = /\s*\(([^()]+)\)\s*$/;

const WORKPLACE: [RegExp, NonNullable<NewVacancy['workFormat']>][] = [
  [/hybrid|гибрид/i, 'hybrid'],
  [/remote|удал[её]нн?/i, 'remote'],
  [/on-?site|in office|на месте|офис/i, 'onsite'],
];

export function splitLocation(raw: string | null): {
  location: string | null;
  workFormat: NewVacancy['workFormat'];
} {
  if (!raw) return { location: null, workFormat: null };
  const suffix = WORKPLACE_SUFFIX_RE.exec(raw)?.[1];
  const format = suffix ? WORKPLACE.find(([re]) => re.test(suffix))?.[1] : undefined;
  if (format) {
    return { location: raw.replace(WORKPLACE_SUFFIX_RE, '').trim() || null, workFormat: format };
  }
  // A bare "Remote" location is a workplace type, not a place.
  if (/^(?:remote|удал[её]нн?о)$/i.test(raw.trim())) return { location: null, workFormat: 'remote' };
  return { location: raw.trim(), workFormat: null };
}

export function linkedInJobUrl(jobId: string): string {
  return `https://www.linkedin.com/jobs/view/${jobId}/`;
}

/**
 * The alert card is all there is: the posting body stays on LinkedIn, and the
 * apply happens there or on the employer's site. The description therefore
 * states the facts the card has and says where the rest is — enough for the
 * résumé ranking and the digest verdict, and honest about being a summary.
 */
function describe(job: LinkedInAlertJob, context: AlertContext, location: string | null): string {
  return [
    `${job.title}${job.company ? ` at ${job.company}` : ''}.`,
    location ? `Location: ${location}.` : null,
    job.salary ? `Salary: ${job.salary}.` : null,
    job.easyApply ? 'Easy Apply on LinkedIn.' : null,
    context.alertQuery ? `Found by the LinkedIn job alert "${context.alertQuery}".` : null,
    'From a LinkedIn job-alert email; the full posting is on LinkedIn.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function normalizeLinkedInJob(job: LinkedInAlertJob, context: AlertContext): NewVacancy {
  const companyRaw = job.company?.trim() || 'Unknown';
  const { location, workFormat } = splitLocation(job.location);
  const salary = parseSalaryString(job.salary ?? undefined);

  return {
    sourceId: context.sourceId,
    externalId: job.jobId,
    url: linkedInJobUrl(job.jobId),
    title: job.title.slice(0, 300),
    companyRaw,
    companyNormalized: normalizeCompanyName(companyRaw),
    description: describe(job, context, location),
    workFormat,
    employmentType: null,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    location,
    publishedAt: context.receivedAt,
  };
}
