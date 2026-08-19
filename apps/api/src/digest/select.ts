import {
  detectSeniority,
  type EmploymentType,
  levelsBelowResume,
  type SeniorityLevel,
  type WorkFormat,
} from '@jobradar/shared';

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
 * fails. The signals are fractions; scaling to a percentage keeps one scale end
 * to end. A candidate with no signal at all scores 0 and drops out — there is
 * nothing to claim a fit percentage from, and inventing one to fill the push
 * would be worse than a short digest. With the lexical score in the mix this
 * path finally has something to say about a fresh account, so an LLM outage
 * costs the digest its precision rather than its existence.
 */
export function fallbackScores(candidates: DigestCandidate[]): ScoredCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    score: Math.round(rankScore(candidate) * 100),
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
 *
 * Objects are read one at a time rather than as one array, because a reply
 * routinely ends mid-sentence: 30 verdicts with Russian notes sit right on the
 * output cap, and a model that reasons before answering spends part of the
 * budget getting there. Parsing the array as a whole turned that into a total
 * loss — an unterminated `[` threw, the caller fell back to cached scores it did
 * not have, and the digest went out empty. Whatever arrived intact is kept.
 */
export function parseBatchReply(
  reply: string,
  candidates: DigestCandidate[],
): ScoredCandidate[] {
  const byIndex = new Map<number, ScoredCandidate>();
  for (const raw of parseObjects(reply)) {
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

/**
 * Every top-level `{...}` in the reply that parses on its own, in order. Braces
 * are counted outside string literals so a note containing `{` or a quote does
 * not shift the boundaries; an object left unclosed at the end of the text is
 * simply never yielded.
 */
function parseObjects(reply: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < reply.length; i += 1) {
    const char = reply[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(reply.slice(start, i + 1));
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            objects.push(parsed as Record<string, unknown>);
          }
        } catch {
          // Not JSON after all — prose that happened to contain braces.
        }
      }
    }
  }

  return objects;
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
