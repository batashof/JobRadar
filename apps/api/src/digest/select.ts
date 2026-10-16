import {
  detectSeniority,
  type EmploymentType,
  levelsBelowResume,
  type SeniorityLevel,
  type WorkFormat,
} from '@jobradar/shared';

/**
 * Ranking for the digest funnel, kept pure.
 *
 * The funnel is three stages, cheapest first: SQL narrows to unsent vacancies
 * ranked by resume relevance; the formula scores every one of them against the
 * candidate profile (ADR-029); every one above the floor goes out, or the best
 * N when the user set a cap (ADR-022).
 */

/**
 * Drops vacancies clearly below the resume's level, by the same rules-based
 * gap the feed filter uses (ADR-012). The model cannot be trusted with this:
 * asked to score an intern posting against a senior resume it happily returns
 * 95. A push is also less forgiving than a browsable feed — an intern card
 * arriving on the phone is pure noise — but the rule stays identical so the
 * product has one definition of "too junior".
 */
export function dropTooJunior<T extends { title: string; seniority: string | null }>(
  candidates: T[],
  resumeLevel: SeniorityLevel | null,
): T[] {
  if (!resumeLevel) return candidates;
  const tooJunior = new Set<string>(levelsBelowResume(resumeLevel));
  if (tooJunior.size === 0) return candidates;

  return candidates.filter((candidate) => {
    // Ingestion's stored level first; fall back to the title, which is where a
    // level word almost always is when the field was never populated.
    const level = candidate.seniority ?? detectSeniority(candidate.title);
    return !level || !tooJunior.has(level);
  });
}

/** What the SQL stage hands to the scorer. */
export interface DigestCandidate {
  id: string;
  title: string;
  company: string;
  description: string;
  location: string | null;
  seniority: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  workFormat: WorkFormat | null;
  employmentType: EmploymentType | null;
  /** Where to apply, extracted from the description at ingestion (ADR-011). */
  applyContact: { kind: string; value: string } | null;
  /** The board this came from, shown on the card so the reader knows the origin. */
  sourceSlug: string | null;
  url: string;
  publishedAt: Date | null;
  /** Rules-based profile-match score, 0..1; 0 when the user has no profile. */
  ruleScore: number;
  /** Cached resume-match score, 0..1; 0 when this pair was never scored. */
  resumeScore: number;
  /** Lexical résumé relevance, 0..1; the one signal that needs nothing cached. */
  lexScore: number;
}

/**
 * How promising a candidate looks before any token is spent — the best of the
 * three signals. They are alternatives, not addends: a user with no search
 * profile has no rules score, a vacancy nobody ever opened has no resume score,
 * and until v1.20.1 a user with neither had nothing at all, which ordered the
 * batch by publication date and fed the LLM whatever was posted last. The
 * lexical score is the floor under that: it exists for every row. Taking the
 * max keeps one 0..1 scale whichever of them happens to be present.
 */
export function rankScore(
  candidate: Pick<DigestCandidate, 'ruleScore' | 'resumeScore' | 'lexScore'>,
): number {
  const best = Math.max(candidate.ruleScore, candidate.resumeScore, candidate.lexScore);
  return Math.max(0, Math.min(1, best));
}

export interface ScoredCandidate extends DigestCandidate {
  /** 0..100 fit against the resume. */
  score: number;
  /** One short line on why it fits, in the account language; may be empty. */
  note: string;
  /** The formula's breakdown, which the card draws as icon rows; absent for an LLM score. */
  fit?: CardFit;
}

/** What the formula found, for the card's ✅ / 🟡 / ❌ rows (v2.5.0). */
export interface CardFit {
  matched: string[];
  related: string[];
  missing: string[];
  grade: 'match' | 'above' | 'below' | 'far' | 'unknown';
}

/**
 * Final cut: above the floor, best first. Ties break towards the fresher
 * posting — an equally good vacancy posted today is worth more than one from
 * last week. A null cap (the default, ADR-022) keeps every one: the user asked
 * for all the news, and a fixed ten silently threw the rest away.
 */
export function shortlist(
  scored: ScoredCandidate[],
  maxItems: number | null,
  minScore: number,
): ScoredCandidate[] {
  const ranked = [...scored]
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || freshness(b) - freshness(a));
  return maxItems === null ? ranked : ranked.slice(0, maxItems);
}

function freshness(item: ScoredCandidate): number {
  return item.publishedAt?.getTime() ?? 0;
}
