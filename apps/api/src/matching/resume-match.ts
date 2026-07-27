/** Prompt + reply parsing for LLM resume ↔ vacancy scoring (ADR-011), kept pure. */

import {
  RESUME_MATCH_DIMENSIONS,
  type Language,
  type ResumeMatchDimension,
  type ResumeMatchDimensionKey,
} from '@jobradar/shared';

const VACANCY_LIMIT = 5000;
const RESUME_LIMIT = 5000;

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * Criterion weights for the overall fit score. Technologies dominate by design
 * (the developer's request); location is a tie-breaker, not a make-or-break.
 * Kept here (not in the DB) so the weighting can evolve without a migration.
 */
export const DIMENSION_WEIGHT: Record<ResumeMatchDimensionKey, number> = {
  stack: 0.4,
  role: 0.25,
  experience: 0.2,
  location: 0.15,
};

/** Weighted average over the present criteria (weights renormalized). */
export function overallScore(breakdown: ResumeMatchDimension[]): number {
  let weightSum = 0;
  let acc = 0;
  for (const d of breakdown) {
    const w = DIMENSION_WEIGHT[d.key];
    acc += w * d.score;
    weightSum += w;
  }
  return weightSum > 0 ? acc / weightSum : 0;
}

export interface ResumeMatchVacancy {
  title: string;
  company: string;
  description: string;
  /** Best-effort vacancy location; the candidate's comes from the resume text. */
  location?: string | null;
}

/**
 * Fit-scoring prompt in the requested interface language (ADR-014). Criterion
 * scores are language-neutral; only the `note`/`summary` text is localised.
 * The model scores each criterion; the overall score is computed here from the
 * weights above, so "tech first" is guaranteed regardless of the model.
 */
export function buildResumeMatchPrompt(
  vacancy: ResumeMatchVacancy,
  resumeText: string,
  lang: Language = 'ru',
): { system: string; user: string } {
  const shape =
    '{"stack":{"score":<0-100>,"note":"..."},"role":{"score":<0-100>,"note":"..."},' +
    '"experience":{"score":<0-100>,"note":"..."},"location":{"score":<0-100>,"note":"..."},' +
    '"summary":"..."}';

  const system =
    lang === 'en'
      ? [
          'You assess how well a vacancy fits a candidate from their resume, criterion by criterion.',
          `Reply strictly with one JSON object and nothing else: ${shape}`,
          'Each score: 0 — no fit at all, 100 — a perfect match. Each note: one short sentence in English naming the concrete overlap or gap. summary: one sentence overall in English. Do not invent facts.',
          'Criteria: "stack" — overlap of technologies, frameworks and tools.',
          '"role" — same specialization/direction (e.g. frontend vs QA vs backend), not just any dev job.',
          '"experience" — the candidate\'s years and seniority against what the role expects.',
          '"location" — whether this employer could realistically work with a candidate from their location, even remotely: sanctions or legal/payment barriers between the countries, an incompatible timezone, or an on-site/relocation requirement the candidate cannot meet. If a location is unknown or the role is openly global-remote, keep this high.',
        ].join(' ')
      : [
          'Ты оцениваешь, насколько вакансия подходит кандидату по его резюме, по каждому критерию отдельно.',
          `Отвечай строго одним JSON-объектом и ничем больше: ${shape}`,
          'Каждый score: 0 — совсем не подходит, 100 — идеальное попадание. Каждый note: одно короткое предложение по-русски с конкретным совпадением или пробелом. summary: одно итоговое предложение по-русски. Не выдумывай фактов.',
          'Критерии: "stack" — совпадение технологий, фреймворков и инструментов.',
          '"role" — то же направление/специализация (например, frontend vs QA vs backend), а не просто любая IT-вакансия.',
          '"experience" — опыт и уровень кандидата против того, что ждёт вакансия.',
          '"location" — сможет ли работодатель реально работать с кандидатом из его локации, даже удалённо: санкции или юридические/платёжные барьеры между странами, несовместимый часовой пояс, требование офиса/релокации, которое кандидат не может выполнить. Если локация где-то неизвестна или вакансия — открытая глобальная удалёнка, держи оценку высокой.',
        ].join(' ');

  const label = lang === 'en' ? 'Vacancy' : 'Вакансия';
  const location = vacancy.location?.trim();
  const locationLine = location
    ? lang === 'en'
      ? `Vacancy location: ${location}`
      : `Локация вакансии: ${location}`
    : null;
  const vacancyBody =
    lang === 'en'
      ? `\nVacancy text:\n${cut(vacancy.description, VACANCY_LIMIT)}`
      : `\nТекст вакансии:\n${cut(vacancy.description, VACANCY_LIMIT)}`;
  const resumeBody =
    lang === 'en'
      ? `\nCandidate resume:\n${cut(resumeText, RESUME_LIMIT)}`
      : `\nРезюме кандидата:\n${cut(resumeText, RESUME_LIMIT)}`;

  const user = [
    `${label}: ${vacancy.title} — ${vacancy.company}`,
    locationLine,
    vacancyBody,
    resumeBody,
  ]
    .filter((part): part is string => part !== null)
    .join('\n');

  return { system, user };
}

export interface ParsedResumeMatch {
  /** Overall fit in [0, 1] — weighted average of `breakdown` (or the legacy flat score). */
  score: number;
  /** One-sentence overall rationale. */
  explanation: string;
  /** Per-criterion breakdown; empty when the reply used the legacy flat shape. */
  breakdown: ResumeMatchDimension[];
}

function to01(raw: number): number {
  return Math.min(100, Math.max(0, raw)) / 100;
}

/**
 * Parses the model reply into per-criterion scores + an overall. Tolerates the
 * legacy flat `{score, explanation}` shape so rows scored before the breakdown
 * existed still parse. Returns null only on unusable garbage.
 */
export function parseResumeMatchReply(text: string): ParsedResumeMatch | null {
  // First `{` … last `}` — a non-greedy match would stop inside a nested object.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const breakdown: ResumeMatchDimension[] = [];
  for (const key of RESUME_MATCH_DIMENSIONS) {
    const dim = parsed[key];
    if (dim && typeof dim === 'object') {
      const rawScore = (dim as { score?: unknown }).score;
      const num = typeof rawScore === 'number' ? rawScore : Number(rawScore);
      if (Number.isFinite(num)) {
        const rawNote = (dim as { note?: unknown }).note;
        const note = typeof rawNote === 'string' ? rawNote.trim() : '';
        breakdown.push({ key, score: to01(num), note });
      }
    }
  }

  if (breakdown.length > 0) {
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    return { score: overallScore(breakdown), explanation: summary, breakdown };
  }

  // Legacy flat shape.
  const raw = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score);
  if (!Number.isFinite(raw)) return null;
  const explanation = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '';
  return { score: to01(raw), explanation, breakdown: [] };
}
