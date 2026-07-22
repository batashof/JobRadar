/** Prompt + reply parsing for LLM resume ↔ vacancy scoring (ADR-011), kept pure. */

import type { Language } from '@jobradar/shared';

const VACANCY_LIMIT = 5000;
const RESUME_LIMIT = 5000;

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export interface ResumeMatchVacancy {
  title: string;
  company: string;
  description: string;
}

/**
 * Fit-scoring prompt in the requested interface language (ADR-014). The score
 * is language-neutral; only the `explanation` is localised.
 */
export function buildResumeMatchPrompt(
  vacancy: ResumeMatchVacancy,
  resumeText: string,
  lang: Language = 'ru',
): { system: string; user: string } {
  const system =
    lang === 'en'
      ? [
          'You assess how well a vacancy fits a candidate based on their resume.',
          'Reply strictly with a single JSON object like {"score": <integer 0-100>, "explanation": "<1-2 sentences in English>"} and nothing else.',
          'score 0 — no fit at all (different profession/stack), 100 — a perfect match.',
          'In explanation name the main overlaps and the main gap, if any. Do not invent facts.',
        ].join(' ')
      : [
          'Ты оцениваешь, насколько вакансия подходит кандидату по его резюме.',
          'Отвечай строго одним JSON-объектом вида {"score": <целое 0-100>, "explanation": "<1-2 предложения по-русски>"} без какого-либо другого текста.',
          'score 0 — совсем не подходит (другая профессия/стек), 100 — идеальное попадание.',
          'В explanation назови главные совпадения и главный пробел, если он есть. Не выдумывай фактов.',
        ].join(' ');

  const label = lang === 'en' ? 'Vacancy' : 'Вакансия';
  const vacancyBody =
    lang === 'en'
      ? `\nVacancy text:\n${cut(vacancy.description, VACANCY_LIMIT)}`
      : `\nТекст вакансии:\n${cut(vacancy.description, VACANCY_LIMIT)}`;
  const resumeBody =
    lang === 'en'
      ? `\nCandidate resume:\n${cut(resumeText, RESUME_LIMIT)}`
      : `\nРезюме кандидата:\n${cut(resumeText, RESUME_LIMIT)}`;

  const user = [`${label}: ${vacancy.title} — ${vacancy.company}`, vacancyBody, resumeBody].join(
    '\n',
  );

  return { system, user };
}

/** Parses the model reply; returns score in [0, 1]. Null on garbage. */
export function parseResumeMatchReply(
  text: string,
): { score: number; explanation: string } | null {
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { score?: unknown; explanation?: unknown };
    const raw = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score);
    if (!Number.isFinite(raw)) return null;
    const score = Math.min(100, Math.max(0, raw)) / 100;
    const explanation = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '';
    return { score, explanation };
  } catch {
    return null;
  }
}
