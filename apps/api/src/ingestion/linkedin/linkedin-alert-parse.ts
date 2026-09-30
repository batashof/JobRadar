import { stripHtml } from '../description';

/**
 * LinkedIn job-alert emails → job cards (ADR-020).
 *
 * LinkedIn runs the search itself and mails the result to the user; JobRadar
 * only reads what arrived in the user's own mailbox. The email is the whole
 * input: title, company, location and sometimes a salary — no posting body.
 *
 * The layout is LinkedIn's to change, so nothing here depends on class names or
 * table nesting. The one stable anchor is the job link, `/jobs/view/<id>`: every
 * card has one, and the id is the posting's permanent identity. Everything else
 * is read relative to it. The HTML part is primary (it carries the salary line);
 * the plain-text part fills gaps and stands in when the HTML yields nothing.
 */

export interface LinkedInAlertJob {
  /** LinkedIn's numeric job id — the posting's stable identity. */
  jobId: string;
  title: string;
  company: string | null;
  location: string | null;
  /** Salary exactly as the card prints it ("$120K/yr - $150K/yr"). */
  salary: string | null;
  easyApply: boolean;
}

export interface LinkedInAlertEmail {
  html?: string | null;
  text?: string | null;
}

/**
 * `/jobs/view/4012345678`, `/comm/jobs/view/4012345678/?trackingId=…` and the
 * slugged `/jobs/view/senior-frontend-engineer-at-acme-4012345678`.
 */
const JOB_LINK_RE =
  /linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/?#"'\s<>]*?-)?(\d{6,})(?![\d])/i;

const SEPARATOR_RE = /^[-=_–—·\s]{3,}$/;

/** "$120K/yr - $150K/yr", "€60K–€80K", "USD 5,000/month". */
const SALARY_RE = /[$€£]\s?\d|\d\s?[kK]\s*\/\s*(?:yr|hr|mo)\b|\b(?:USD|EUR|GBP)\b/;

const EASY_APPLY_RE = /easy apply|быстрый отклик|простая подача/i;

/**
 * Lines that are card chrome, not card content. The positional read (title,
 * company, location) only works once these are gone. English and Russian,
 * because the email follows the interface language of the LinkedIn account.
 */
const NOISE_PATTERNS: RegExp[] = [
  /^https?:\/\//i,
  /^view job/i,
  /^(?:see|view|show) (?:all|more)/i,
  /^apply\b/i,
  EASY_APPLY_RE,
  /actively (?:hiring|recruiting)/i,
  /early applicant/i,
  /^promoted\b/i,
  /^new$/i,
  /\bconnections?\b/i,
  /\balumni\b/i,
  /\bapplicants?\b/i,
  /fast[- ]growing/i,
  /response insights|responds within/i,
  /^your job alert/i,
  /\bnew jobs? match/i,
  /jobs? you may be interested in/i,
  /^top job picks/i,
  /^посмотреть/i,
  /активно (?:нанимает|ищет)/i,
  /\bконтакт/i,
  /кандидат/i,
  /выпускник/i,
  /оповещени/i,
  /новых? ваканси/i,
];

const isNoise = (line: string): boolean => NOISE_PATTERNS.some((re) => re.test(line));

export function extractJobId(href: string): string | null {
  return JOB_LINK_RE.exec(href)?.[1] ?? null;
}

/** Block-level HTML → one visible line per block, entities decoded. */
export function htmlToLines(html: string): string[] {
  const blocked = html
    .replace(/<(?:style|script|head)\b[\s\S]*?<\/(?:style|script|head)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|td|th|tr|table|li|ul|ol|h[1-6])>/gi, '\n');
  return blocked
    .split('\n')
    .map((line) => stripHtml(line))
    .filter((line) => line.length > 0 && !SEPARATOR_RE.test(line) && !/^[·•|]$/.test(line));
}

interface CardFields {
  company: string | null;
  location: string | null;
  salary: string | null;
  easyApply: boolean;
}

/**
 * What follows a card's title: "Company · Location" on one line (the HTML
 * layout) or company and location on consecutive lines (the text layout).
 */
function readCardFields(lines: string[]): CardFields {
  const easyApply = lines.some((line) => EASY_APPLY_RE.test(line));
  const salary = lines.find((line) => SALARY_RE.test(line) && !isNoise(line)) ?? null;
  const content = lines.filter((line) => !isNoise(line) && line !== salary);

  const first = content[0] ?? null;
  if (first && /\s[·•|]\s/.test(first)) {
    const [company, ...rest] = first.split(/\s[·•|]\s/).map((part) => part.trim());
    return { company: company || null, location: rest.join(', ') || null, salary, easyApply };
  }
  return { company: first, location: content[1] ?? null, salary, easyApply };
}

/** Upper bound on one card's HTML, so the last card cannot swallow the footer. */
const MAX_CARD_HTML = 6000;

export function parseAlertHtml(html: string): LinkedInAlertJob[] {
  const anchors: { id: string; start: number; text: string }[] = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[1] ?? '')?.[1];
    const id = href ? extractJobId(href) : null;
    if (!id) continue;
    anchors.push({ id, start: m.index, text: stripHtml(m[2] ?? '') });
  }

  const order: string[] = [];
  for (const anchor of anchors) if (!order.includes(anchor.id)) order.push(anchor.id);

  const jobs: LinkedInAlertJob[] = [];
  order.forEach((id, index) => {
    const own = anchors.filter((a) => a.id === id);
    // The logo link carries no text; "View job"-style links are chrome.
    const title = own.map((a) => a.text).find((text) => text.length > 1 && !isNoise(text));
    if (!title) return;

    const start = own[0]!.start;
    const nextId = order[index + 1];
    const next = nextId ? anchors.find((a) => a.id === nextId)!.start : html.length;
    const lines = htmlToLines(html.slice(start, Math.min(next, start + MAX_CARD_HTML)));
    const titleAt = lines.findIndex((line) => line === title);
    const after = titleAt >= 0 ? lines.slice(titleAt + 1) : lines;

    jobs.push({ jobId: id, title, ...readCardFields(after.slice(0, 8)) });
  });
  return jobs;
}

/**
 * Plain-text layout: a card's lines come first, then the link line
 * ("View job: https://…/jobs/view/<id>/…"), then a dashed separator.
 */
export function parseAlertText(text: string): LinkedInAlertJob[] {
  const jobs: LinkedInAlertJob[] = [];
  const seen = new Set<string>();
  let buffer: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (SEPARATOR_RE.test(line)) {
      buffer = [];
      continue;
    }
    const id = extractJobId(line);
    if (!id) {
      buffer.push(line);
      continue;
    }

    const content = buffer.filter((l) => !isNoise(l) && !SALARY_RE.test(l));
    const title = content[0];
    if (title && !seen.has(id)) {
      seen.add(id);
      jobs.push({ jobId: id, title, ...readCardFields(buffer.slice(buffer.indexOf(title) + 1)) });
    }
    buffer = [];
  }
  return jobs;
}

/**
 * All cards in one alert email, HTML first. A card the text part also has
 * lends it whatever the HTML read missed; a card only the text part has is
 * kept too.
 */
export function parseLinkedInAlert(email: LinkedInAlertEmail): LinkedInAlertJob[] {
  const fromHtml = email.html ? parseAlertHtml(email.html) : [];
  const fromText = email.text ? parseAlertText(email.text) : [];
  const byId = new Map(fromHtml.map((job) => [job.jobId, job]));

  for (const job of fromText) {
    const known = byId.get(job.jobId);
    if (!known) {
      byId.set(job.jobId, job);
      continue;
    }
    byId.set(job.jobId, {
      ...known,
      company: known.company ?? job.company,
      location: known.location ?? job.location,
      salary: known.salary ?? job.salary,
      easyApply: known.easyApply || job.easyApply,
    });
  }
  return [...byId.values()];
}

/** "Your job alert for senior frontend engineer in European Union" → the query. */
export function extractAlertQuery(email: LinkedInAlertEmail): string | null {
  const lines = [
    ...(email.text ? email.text.split(/\r?\n/) : []),
    ...(email.html ? htmlToLines(email.html) : []),
  ];
  for (const line of lines) {
    const m = /your job alert for\s+(.+)/i.exec(line.trim());
    if (m?.[1]) return m[1].trim().slice(0, 200);
  }
  return null;
}
