import type { EmploymentType, WorkFormat } from '@jobradar/shared';

/**
 * Rules-based vacancy ↔ search-profile scoring (phase 3, v1).
 *
 * Hard filters reject outright; text signals (keywords, stack) produce the
 * score. LLM scoring may replace this in phase 4 (ADR-005) — keep the
 * interface (inputs in, score-or-null out) stable.
 */

export interface MatchProfileInput {
  keywords: string[];
  stack: string[];
  workFormat: WorkFormat[];
  employmentType: EmploymentType[];
  salaryMin: number | null;
  salaryCurrency: string | null;
}

export interface MatchVacancyInput {
  title: string;
  description: string;
  workFormat: WorkFormat | null;
  employmentType: EmploymentType | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

/** Weight of keyword hits vs stack hits when a profile defines both lists. */
export const KEYWORD_WEIGHT = 0.65;
export const STACK_WEIGHT = 0.35;
/** A description-only hit is worth less than a hit in the title. */
export const DESCRIPTION_HIT_VALUE = 0.7;
/** Score for profiles with no text criteria at all (structured filters only). */
export const FILTER_ONLY_SCORE = 0.25;

/**
 * Matches a term at word boundaries, Unicode-aware (RU + EN sources; a plain
 * `\b` fails on Cyrillic). "go" must not hit "google", but "c++" still works —
 * the lookarounds only reject adjacent letters/digits.
 */
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Per-term hit value: title beats description-only; 0 = no hit. */
function termHit(term: string, title: string, description: string): number {
  const pattern = termPattern(term);
  if (pattern.test(title)) return 1;
  if (pattern.test(description)) return DESCRIPTION_HIT_VALUE;
  return 0;
}

function listScore(terms: string[], title: string, description: string): number {
  if (terms.length === 0) return 0;
  let sum = 0;
  for (const term of terms) sum += termHit(term, title, description);
  return sum / terms.length;
}

/** Sources emit 0 for "no salary" — treat non-positive values as unknown. */
function positiveOrNull(value: number | null): number | null {
  return value != null && value > 0 ? value : null;
}

/**
 * Scores a vacancy against a profile. Returns a score in (0, 1] or null when
 * the vacancy does not match. Unknown vacancy attributes (null work format,
 * missing salary) never reject — only a known conflicting value does.
 */
export function scoreMatch(profile: MatchProfileInput, vacancy: MatchVacancyInput): number | null {
  if (
    profile.workFormat.length > 0 &&
    vacancy.workFormat !== null &&
    !profile.workFormat.includes(vacancy.workFormat)
  ) {
    return null;
  }

  if (
    profile.employmentType.length > 0 &&
    vacancy.employmentType !== null &&
    !profile.employmentType.includes(vacancy.employmentType)
  ) {
    return null;
  }

  if (profile.salaryMin != null) {
    const ceiling = positiveOrNull(vacancy.salaryMax) ?? positiveOrNull(vacancy.salaryMin);
    // Only compare within one currency; cross-currency amounts are incomparable
    // without rates, so they pass (better a match than a wrong rejection).
    const comparable =
      profile.salaryCurrency == null ||
      vacancy.salaryCurrency == null ||
      profile.salaryCurrency.toUpperCase() === vacancy.salaryCurrency.toUpperCase();
    if (ceiling != null && comparable && ceiling < profile.salaryMin) return null;
  }

  const hasKeywords = profile.keywords.length > 0;
  const hasStack = profile.stack.length > 0;
  if (!hasKeywords && !hasStack) return FILTER_ONLY_SCORE;

  const keywordScore = listScore(profile.keywords, vacancy.title, vacancy.description);
  const stackScore = listScore(profile.stack, vacancy.title, vacancy.description);

  // The profile's primary text signal must hit at least once: keywords when
  // present, otherwise stack. A secondary signal alone is only a booster.
  if (hasKeywords && keywordScore === 0) return null;
  if (!hasKeywords && stackScore === 0) return null;

  if (hasKeywords && hasStack) {
    return KEYWORD_WEIGHT * keywordScore + STACK_WEIGHT * stackScore;
  }
  return hasKeywords ? keywordScore : stackScore;
}

/** Plan to reconcile materialized rows with freshly computed scores. */
export interface MatchDiff {
  inserts: { vacancyId: string; score: number }[];
  /** Existing rows whose score changed (matched_at / digested_at are kept). */
  updates: { vacancyId: string; score: number }[];
  deletes: string[];
}

const SCORE_EPSILON = 1e-6;

export function diffMatches(
  existing: ReadonlyMap<string, number>,
  desired: ReadonlyMap<string, number>,
): MatchDiff {
  const diff: MatchDiff = { inserts: [], updates: [], deletes: [] };
  for (const [vacancyId, score] of desired) {
    const current = existing.get(vacancyId);
    if (current === undefined) diff.inserts.push({ vacancyId, score });
    else if (Math.abs(current - score) > SCORE_EPSILON) diff.updates.push({ vacancyId, score });
  }
  for (const vacancyId of existing.keys()) {
    if (!desired.has(vacancyId)) diff.deletes.push(vacancyId);
  }
  return diff;
}
