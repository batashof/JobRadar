import { detectSeniority, levelsBelowResume, type SeniorityLevel } from '@jobradar/shared';

/**
 * Ranking and prompt handling for the digest funnel, kept pure.
 *
 * The funnel is three stages, cheapest first: SQL narrows to vacancies that
 * already pass rules-based profile matching and were never sent; a single LLM
 * call scores that shortlist against the resume; the top N above the floor go
 * out. One LLM call per digest is the whole point — per-vacancy scoring would
 * be ~30 calls a day against a free tier (ADR-005).
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
  url: string;
  publishedAt: Date | null;
  /** Rules-based profile-match score, 0..1 — the fallback ranking. */
  ruleScore: number;
}

export interface ScoredCandidate extends DigestCandidate {
  /** 0..100 fit against the resume. */
  score: number;
  /** One short line on why it fits, in the account language; may be empty. */
  note: string;
}

/**
 * Final cut: above the floor, best first, capped. Ties break towards the
 * fresher posting — an equally good vacancy posted today is worth more than
 * one from last week.
 */
export function shortlist(
  scored: ScoredCandidate[],
  maxItems: number,
  minScore: number,
): ScoredCandidate[] {
  return [...scored]
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || freshness(b) - freshness(a))
    .slice(0, maxItems);
}

function freshness(item: ScoredCandidate): number {
  return item.publishedAt?.getTime() ?? 0;
}

/**
 * Deterministic ranking used when no LLM provider is configured or the call
 * fails. The rules score is a fraction; scaling it to a percentage keeps one
 * scale end to end, and `fallback` lets the caller say so honestly.
 */
export function fallbackScores(candidates: DigestCandidate[]): ScoredCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    score: Math.round(Math.max(0, Math.min(1, candidate.ruleScore)) * 100),
    note: '',
  }));
}

/**
 * Compact cards for the batch prompt. Descriptions are cut hard: the model is
 * ranking, not reading — the full text is one tap away in the app.
 */
export function buildBatchPrompt(
  candidates: DigestCandidate[],
  resumeText: string,
  lang: 'en' | 'ru',
): { system: string; user: string } {
  const cards = candidates
    .map((candidate, index) =>
      [
        `#${index}`,
        `title: ${candidate.title}`,
        `company: ${candidate.company}`,
        candidate.location ? `location: ${candidate.location}` : null,
        candidate.seniority ? `seniority: ${candidate.seniority}` : null,
        salaryLine(candidate),
        `description: ${cut(candidate.description, 700)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n---\n');

  const noteLanguage = lang === 'en' ? 'English' : 'Russian';

  const system =
    'You rank job vacancies against a candidate resume. You are strict: a high ' +
    'score means the candidate could realistically be hired for that role today. ' +
    'Missing the core stack, or a seniority gap of two grades or more, caps the ' +
    'score below 50. Answer with JSON only, no prose and no code fences.';

  const user = [
    'RESUME:',
    cut(resumeText, 4000),
    '',
    'VACANCIES:',
    cards,
    '',
    'For every vacancy return an object with:',
    '  "i": the vacancy number,',
    '  "score": integer 0-100, how well this candidate fits it,',
    `  "note": one short sentence in ${noteLanguage} on the decisive reason (max 120 chars).`,
    'Return a JSON array of those objects and nothing else.',
  ].join('\n');

  return { system, user };
}

/**
 * Parses the batch reply and joins it back onto the candidates. Anything the
 * model got wrong — a fenced block, a missing entry, an out-of-range score, an
 * index it invented — is dropped rather than trusted: a hallucinated vacancy in
 * a digest is worse than a shorter digest.
 */
export function parseBatchReply(
  reply: string,
  candidates: DigestCandidate[],
): ScoredCandidate[] {
  const json = extractJsonArray(reply);
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const byIndex = new Map<number, ScoredCandidate>();
  for (const raw of parsed) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as { i?: unknown; score?: unknown; note?: unknown };
    const index = Number(entry.i);
    const score = Number(entry.score);
    const candidate = candidates[index];
    if (!candidate || !Number.isInteger(index) || !Number.isFinite(score)) continue;
    // One score per vacancy: a repeated index keeps the first verdict.
    if (byIndex.has(index)) continue;

    byIndex.set(index, {
      ...candidate,
      score: Math.round(Math.max(0, Math.min(100, score))),
      note: typeof entry.note === 'string' ? entry.note.trim().slice(0, 160) : '',
    });
  }

  return [...byIndex.values()];
}

function extractJsonArray(reply: string): string | null {
  const start = reply.indexOf('[');
  const end = reply.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  return reply.slice(start, end + 1);
}

function salaryLine(candidate: DigestCandidate): string | null {
  if (!candidate.salaryMin && !candidate.salaryMax) return null;
  const currency = candidate.salaryCurrency ?? '';
  const range = [candidate.salaryMin, candidate.salaryMax].filter(Boolean).join('-');
  return `salary: ${range} ${currency}`.trim();
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
