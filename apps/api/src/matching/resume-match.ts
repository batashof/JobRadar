/** Prompt + reply parsing for LLM resume ↔ vacancy scoring (ADR-011), kept pure. */

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

export function buildResumeMatchPrompt(
  vacancy: ResumeMatchVacancy,
  resumeText: string,
): { system: string; user: string } {
  const system = [
    'Ты оцениваешь, насколько вакансия подходит кандидату по его резюме.',
    'Отвечай строго одним JSON-объектом вида {"score": <целое 0-100>, "explanation": "<1-2 предложения по-русски>"} без какого-либо другого текста.',
    'score 0 — совсем не подходит (другая профессия/стек), 100 — идеальное попадание.',
    'В explanation назови главные совпадения и главный пробел, если он есть. Не выдумывай фактов.',
  ].join(' ');

  const user = [
    `Вакансия: ${vacancy.title} — ${vacancy.company}`,
    `\nТекст вакансии:\n${cut(vacancy.description, VACANCY_LIMIT)}`,
    `\nРезюме кандидата:\n${cut(resumeText, RESUME_LIMIT)}`,
  ].join('\n');

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
