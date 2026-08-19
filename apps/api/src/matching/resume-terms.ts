import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Lexical relevance of a vacancy to a resume, computed in SQL.
 *
 * Everything else that ranks vacancies for a user needs something cached first:
 * `profile_matches` needs a search profile, `resume_matches` needs an LLM call
 * that already happened. A fresh account has neither, and ordering by
 * `published_at` then hands the expensive stages whatever was posted last —
 * product managers and designers for a frontend resume. This module is the
 * signal that always exists: it costs no tokens, works on the first run, and
 * only reads the resume the user already uploaded.
 *
 * It ranks, it never rejects. A term list is a weak description of a career, so
 * a vacancy that matches nothing here still reaches the LLM if the pool is
 * small enough — the same lesson as ADR-015 §4 (a narrowing signal must not
 * become an entry condition).
 */

export interface ResumeTerms {
  /** Job-family words for the title: what kind of job this résumé is after. */
  roles: string[];
  /** Technologies the résumé actually mentions, most-mentioned first. */
  stack: string[];
}

/**
 * Job families, each expanded to the words a posting uses for the same job.
 * Every term of a matched family counts as a title signal — "Senior Frontend
 * Engineer" and "Web Developer" are the same job to a frontend résumé.
 */
export const ROLE_FAMILIES: { family: string; terms: string[] }[] = [
  {
    family: 'frontend',
    terms: ['frontend', 'front-end', 'front end', 'web developer', 'ui engineer', 'фронтенд'],
  },
  { family: 'fullstack', terms: ['fullstack', 'full-stack', 'full stack'] },
  {
    family: 'backend',
    terms: ['backend', 'back-end', 'back end', 'server-side', 'бэкенд'],
  },
  { family: 'mobile', terms: ['mobile developer', 'ios developer', 'android developer', 'react native'] },
  { family: 'devops', terms: ['devops', 'sre', 'site reliability', 'platform engineer', 'infrastructure engineer'] },
  { family: 'qa', terms: ['qa engineer', 'test engineer', 'quality assurance', 'sdet', 'тестировщик'] },
  { family: 'data', terms: ['data engineer', 'data scientist', 'data analyst', 'machine learning', 'ml engineer'] },
  { family: 'design', terms: ['product designer', 'ux designer', 'ui designer', 'дизайнер'] },
  { family: 'product', terms: ['product manager', 'product owner', 'продакт'] },
  { family: 'analytics', terms: ['business analyst', 'systems analyst', 'аналитик'] },
];

/**
 * Technologies worth recognising in a résumé. Deliberately a closed list: free
 * text extraction turns "experience", "team" and "remote" into signals, and
 * those match every posting ever written.
 */
export const STACK_TERMS: string[] = [
  'react', 'react native', 'next.js', 'vue', 'nuxt', 'angular', 'svelte', 'typescript', 'javascript',
  'redux', 'mobx', 'rxjs', 'graphql', 'apollo', 'webpack', 'vite', 'babel', 'html', 'css', 'sass',
  'scss', 'tailwind', 'storybook', 'jest', 'vitest', 'cypress', 'playwright', 'testing library',
  'node.js', 'nestjs', 'express', 'deno', 'bun', 'python', 'django', 'flask', 'fastapi', 'java',
  'spring', 'kotlin', 'swift', 'objective-c', 'go', 'rust', 'c#', '.net', 'php', 'laravel', 'ruby',
  'rails', 'elixir', 'scala', 'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch',
  'kafka', 'rabbitmq', 'docker', 'kubernetes', 'terraform', 'ansible', 'aws', 'gcp', 'azure',
  'ci/cd', 'jenkins', 'github actions', 'grafana', 'prometheus', 'figma', 'websocket', 'rest api',
  'microservices', 'ssr', 'pwa', 'webrtc', 'three.js', 'd3', 'tensorflow', 'pytorch', 'sql',
];

/**
 * How many technologies carry over into the query. A résumé lists everything
 * ever touched; the tail is noise that matches unrelated postings, and a long
 * alternation is slower for Postgres to run over every description.
 */
export const RESUME_STACK_LIMIT = 12;

/**
 * How present a job family must be, relative to the strongest one, to count as
 * one of the résumé's own. Taking every family that is mentioned at all is too
 * generous: a frontend résumé that says "worked with the DevOps team" pulled in
 * the whole DevOps vocabulary and, because the terms carry equal weight, filled
 * two thirds of the batch with infrastructure roles. A career has a centre —
 * this keeps the families near it and drops the ones merely brushed against.
 */
export const ROLE_FAMILY_SHARE = 0.5;

/** A role word in the title is the strongest cheap evidence of the right job. */
export const ROLE_TITLE_WEIGHT = 3;
/** A technology in the title: right stack, job family still unconfirmed. */
export const STACK_TITLE_WEIGHT = 2;
/** A technology anywhere in the posting — real, but every posting lists many. */
export const STACK_BODY_WEIGHT = 1;

/** Everything hitting at once. Used to bring the raw sum onto the shared 0..1 scale. */
export const LEX_MAX_RAW = ROLE_TITLE_WEIGHT + STACK_TITLE_WEIGHT + STACK_BODY_WEIGHT;

/**
 * How much of a description is scanned. Postings run to 17k characters and the
 * stack is always named early; scanning all of them for every candidate on
 * every digest run buys nothing.
 */
export const DESCRIPTION_SCAN_CHARS = 4000;

/** Word-boundary, Unicode-aware, same rule as `match-logic.ts` uses in JS. */
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
}

function countHits(term: string, text: string): number {
  return text.match(termPattern(term))?.length ?? 0;
}

/** Reads a résumé into the two term lists. Empty lists for an empty résumé. */
export function extractResumeTerms(resumeText: string): ResumeTerms {
  const text = resumeText.toLowerCase();
  if (!text.trim()) return { roles: [], stack: [] };

  const families = ROLE_FAMILIES.map((family) => ({
    family,
    hits: family.terms.reduce((sum, term) => sum + countHits(term, text), 0),
  })).filter((entry) => entry.hits > 0);

  const strongest = families.reduce((max, entry) => Math.max(max, entry.hits), 0);
  const roles = families
    .filter((entry) => entry.hits >= strongest * ROLE_FAMILY_SHARE)
    .flatMap((entry) => entry.family.terms);

  const stack = STACK_TERMS.map((term) => ({ term, count: countHits(term, text) }))
    .filter((entry) => entry.count > 0)
    // Most-mentioned first; ties keep dictionary order so the result is stable.
    .sort((a, b) => b.count - a.count)
    .slice(0, RESUME_STACK_LIMIT)
    .map((entry) => entry.term);

  return { roles, stack };
}

/**
 * Postgres ERE alternation matching any term at word boundaries. `\y` only
 * means something next to a word character, so a term like `c#` or `.net`
 * carries the boundary on the side that has one — otherwise it would match
 * nothing at all.
 */
export function termsPattern(terms: string[]): string | null {
  if (terms.length === 0) return null;
  return terms.map(alternative).join('|');
}

function alternative(term: string): string {
  const escaped = term.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
  const isWord = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char);
  const lead = isWord(term[0]) ? '\\y' : '';
  const tail = isWord(term[term.length - 1]) ? '\\y' : '';
  return `${lead}${escaped}${tail}`;
}

/**
 * The raw relevance sum as a SQL expression, for ordering a candidate query.
 * Constant `0` when the résumé yielded no terms, which leaves whatever ordering
 * the caller adds after it in charge — no résumé must never mean no candidates.
 */
export function lexicalRelevanceSql(
  terms: ResumeTerms,
  title: AnyPgColumn,
  description: AnyPgColumn,
): SQL<number> {
  const rolePattern = termsPattern(terms.roles);
  const stackPattern = termsPattern(terms.stack);
  if (!rolePattern && !stackPattern) return sql<number>`0`;

  const parts: SQL[] = [];
  if (rolePattern) {
    parts.push(sql`(case when ${title} ~* ${rolePattern} then ${ROLE_TITLE_WEIGHT} else 0 end)`);
  }
  if (stackPattern) {
    parts.push(sql`(case when ${title} ~* ${stackPattern} then ${STACK_TITLE_WEIGHT} else 0 end)`);
    parts.push(
      sql`(case when left(${description}, ${DESCRIPTION_SCAN_CHARS}) ~* ${stackPattern} then ${STACK_BODY_WEIGHT} else 0 end)`,
    );
  }

  return sql<number>`(${sql.join(parts, sql` + `)})`;
}

/** Brings the raw sum onto the 0..1 scale the other ranking signals use. */
export function normalizeLexScore(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / LEX_MAX_RAW);
}
