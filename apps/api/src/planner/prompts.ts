import type { Language, PlanCandidate } from '@jobradar/shared';

/**
 * Plan composition (ADR-015 §2). The LLM **selects and sequences** candidates
 * that were collected with plain SQL — it never invents work. Pure functions,
 * so the contract is pinned by tests without calling a provider.
 */

/** One entry of the LLM's answer, after validation against the candidate list. */
export interface ComposedBlock {
  /** Candidate key; guaranteed to exist in the offered list. */
  key: string;
  /** Optional shorter/sharper title; falls back to the candidate's own. */
  title?: string;
  /** Optional override of the candidate's default timebox. */
  estimateMinutes?: number;
}

export const PLAN_TITLE_LIMIT = 120;
const ESTIMATE_BOUNDS = { min: 5, max: 240 } as const;

export function buildComposePrompt(
  candidates: PlanCandidate[],
  context: {
    capacityMinutes: number;
    estimationFactor: number;
    intent?: string | null;
    lang: Language;
  },
): { system: string; user: string } {
  const language = context.lang === 'ru' ? 'Russian' : 'English';
  const system = [
    'You plan one working day for a job seeker who is applying for jobs, preparing for interviews and taking a course.',
    'You are given a list of candidate tasks. Reply with ONE JSON object and nothing else, shaped exactly as:',
    '{"blocks":[{"key":"<candidate key>","title":"...","estimateMinutes":30}]}',
    'Rules:',
    '- Use ONLY the given candidate keys. Never invent a task, never repeat a key.',
    '- Pick 3–6 blocks that fit the capacity after multiplying estimates by the estimation factor. Fewer good blocks beat a full but impossible day.',
    '- Debt comes first, then anything time-critical (an application going cold), then preparation and learning.',
    '- Alternate heavy and light work rather than stacking three deep blocks in a row.',
    '- "title" is a short imperative restatement of the candidate; keep it under 80 characters.',
    `- Write every title in ${language}.`,
    '- No prose, no markdown, no comments — JSON only.',
  ].join('\n');

  const list = candidates
    .map((candidate) => {
      const carry = candidate.carryCount ? ` [carried ${candidate.carryCount}x]` : '';
      return `- key=${candidate.key} | ${candidate.sourceKind} | ${candidate.estimateMinutes} min${carry} | ${candidate.title} — ${candidate.reason}`;
    })
    .join('\n');

  const user = [
    `Capacity today: ${context.capacityMinutes} minutes.`,
    `Estimation factor: ${context.estimationFactor} (this person actually takes estimate x factor).`,
    context.intent ? `What the day is about: ${context.intent}` : null,
    '',
    'Candidates:',
    list,
    '',
    'Compose the day now.',
  ]
    .filter((line) => line !== null)
    .join('\n');

  return { system, user };
}

/** Extracts the first balanced JSON object, tolerating fences and stray prose. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parses the reply and keeps only entries that map to a real candidate. A
 * hallucinated key is dropped rather than trusted, which is what stops the
 * planner from inventing work.
 */
export function parseComposeReply(text: string, candidates: PlanCandidate[]): ComposedBlock[] {
  const json = extractJsonObject(text);
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const rawBlocks = (parsed as { blocks?: unknown }).blocks;
  if (!Array.isArray(rawBlocks)) return [];

  const known = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const used = new Set<string>();
  const blocks: ComposedBlock[] = [];

  for (const raw of rawBlocks) {
    const entry = raw as { key?: unknown; title?: unknown; estimateMinutes?: unknown };
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    if (!known.has(key) || used.has(key)) continue;
    used.add(key);

    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    const minutes = Number(entry.estimateMinutes);
    const estimateMinutes =
      Number.isFinite(minutes) && minutes >= ESTIMATE_BOUNDS.min && minutes <= ESTIMATE_BOUNDS.max
        ? Math.round(minutes)
        : undefined;

    blocks.push({
      key,
      ...(title ? { title: title.slice(0, PLAN_TITLE_LIMIT) } : {}),
      ...(estimateMinutes ? { estimateMinutes } : {}),
    });
  }

  return blocks;
}
