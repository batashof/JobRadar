/**
 * Prompt builders for the apply assistant (ADR-011). Pure functions so tests
 * can pin the contracts without an LLM. Inputs are truncated here — token
 * discipline is the caller's job nowhere else (ADR-005).
 */

import type { Language } from '@jobradar/shared';

export const VACANCY_TEXT_LIMIT = 6000;
export const RESUME_TEXT_LIMIT = 5000;

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export interface VacancyPromptInput {
  title: string;
  company: string;
  description: string;
  location?: string | null;
}

/**
 * Vacancy brief in the requested interface language (ADR-014): who the employer
 * is, what the role is, how well it fits. Same three-part structure in both.
 */
export function buildBriefPrompt(
  vacancy: VacancyPromptInput,
  resumeText: string | null,
  lang: Language = 'ru',
): { system: string; user: string } {
  return lang === 'en'
    ? buildBriefPromptEn(vacancy, resumeText)
    : buildBriefPromptRu(vacancy, resumeText);
}

function buildBriefPromptRu(
  vacancy: VacancyPromptInput,
  resumeText: string | null,
): { system: string; user: string } {
  const system = [
    'Ты — ассистент по поиску работы. Отвечай только по-русски, кратко и по делу.',
    'Не выдумывай фактов: если чего-то нет в тексте вакансии, так и скажи.',
  ].join(' ');

  const fitSection = resumeText
    ? `\n\nРезюме кандидата (для оценки соответствия):\n${truncate(resumeText, RESUME_TEXT_LIMIT)}`
    : '';

  const user = [
    'Составь краткий бриф по вакансии из трёх частей:',
    '1. Работодатель: что за компания, чем занимается (по тексту вакансии; если неясно — скажи прямо).',
    '2. Суть вакансии: роль, ключевые требования, формат/условия.',
    resumeText
      ? '3. Соответствие кандидату: насколько вакансия подходит под резюме — сильные совпадения и явные пробелы.'
      : '3. На кого рассчитана вакансия: какой опыт и уровень здесь ждут.',
    'Всего не больше 150 слов, без воды.',
    `\nВакансия: ${vacancy.title} — ${vacancy.company}${vacancy.location ? ` (${vacancy.location})` : ''}`,
    `\nТекст вакансии:\n${truncate(vacancy.description, VACANCY_TEXT_LIMIT)}`,
    fitSection,
  ].join('\n');

  return { system, user };
}

function buildBriefPromptEn(
  vacancy: VacancyPromptInput,
  resumeText: string | null,
): { system: string; user: string } {
  const system = [
    'You are a job-search assistant. Reply in English only, concise and to the point.',
    'Never invent facts: if something is not in the vacancy text, say so plainly.',
  ].join(' ');

  const fitSection = resumeText
    ? `\n\nCandidate resume (for the fit assessment):\n${truncate(resumeText, RESUME_TEXT_LIMIT)}`
    : '';

  const user = [
    'Write a short vacancy brief in three parts:',
    '1. Employer: what the company is and what it does (from the vacancy text; say so plainly if unclear).',
    '2. The role: responsibilities, key requirements, format/conditions.',
    resumeText
      ? '3. Fit for the candidate: how well the vacancy matches the resume — strong overlaps and clear gaps.'
      : '3. Who it is for: what experience and level are expected here.',
    'No more than 150 words total, no filler.',
    `\nVacancy: ${vacancy.title} — ${vacancy.company}${vacancy.location ? ` (${vacancy.location})` : ''}`,
    `\nVacancy text:\n${truncate(vacancy.description, VACANCY_TEXT_LIMIT)}`,
    fitSection,
  ].join('\n');

  return { system, user };
}

/**
 * Cover letter: written in the vacancy's language, English calibrated to the
 * level evident in the resume, short and grounded in real experience.
 */
export function buildCoverLetterPrompt(
  vacancy: VacancyPromptInput,
  resumeText: string,
): { system: string; user: string } {
  const system = [
    'You write job application cover letters.',
    'Rules you never break:',
    '- Write in the language the vacancy text is written in (Russian vacancy → Russian letter, English vacancy → English letter).',
    '- If writing in English, match the proficiency level evident in the resume (grammar and vocabulary the candidate could realistically produce) — never write above it.',
    '- 120–180 words. Dense and specific, zero filler and zero flattery.',
    '- Ground every claim in the resume; show the depth of real experience relevant to this vacancy, not the quantity of jobs. Never invent facts, numbers, or names.',
    '- Structure: greeting, 2–3 short paragraphs, sign-off with the candidate name from the resume.',
    '- Output the letter as plain text only — no subject line, no placeholders like [Company], no commentary.',
  ].join('\n');

  const user = [
    `Vacancy: ${vacancy.title} — ${vacancy.company}${vacancy.location ? ` (${vacancy.location})` : ''}`,
    `\nVacancy text:\n${truncate(vacancy.description, VACANCY_TEXT_LIMIT)}`,
    `\nCandidate resume:\n${truncate(resumeText, RESUME_TEXT_LIMIT)}`,
    '\nWrite the cover letter now.',
  ].join('\n');

  return { system, user };
}

/**
 * Application email around the cover letter: subject + short body in the
 * vacancy's language. Returned by the LLM as two parts split by a marker.
 */
export const EMAIL_SUBJECT_MARKER = 'SUBJECT:';
export const EMAIL_BODY_MARKER = 'BODY:';

export function buildApplyEmailPrompt(
  vacancy: VacancyPromptInput,
  coverLetter: string,
  candidateEmail: string,
): { system: string; user: string } {
  const system = [
    'You draft short job-application emails.',
    'Rules:',
    `- Reply with exactly two blocks: "${EMAIL_SUBJECT_MARKER} <subject line>" then "${EMAIL_BODY_MARKER}" followed by the email body. No other commentary.`,
    '- Same language as the vacancy text.',
    '- Subject: position name + candidate value in a few words, no clickbait.',
    '- Body: 1–2 sentences of intro, then the cover letter verbatim, then a sign-off mentioning the attached resume (PDF).',
    '- Never invent facts. Keep the whole body under 250 words.',
  ].join('\n');

  const user = [
    `Vacancy: ${vacancy.title} — ${vacancy.company}`,
    `Candidate email: ${candidateEmail}`,
    `\nVacancy text (for language and context):\n${truncate(vacancy.description, 2000)}`,
    `\nCover letter to include verbatim:\n${coverLetter}`,
    '\nDraft the email now.',
  ].join('\n');

  return { system, user };
}

/** Splits the LLM apply-email reply into subject and body. */
export function parseApplyEmail(text: string): { subject: string; body: string } | null {
  const subjectMatch = text.match(new RegExp(`${EMAIL_SUBJECT_MARKER}\\s*(.+)`));
  const bodyIndex = text.indexOf(EMAIL_BODY_MARKER);
  if (!subjectMatch || bodyIndex < 0) return null;
  const subject = (subjectMatch[1] ?? '').split('\n')[0]?.trim() ?? '';
  const body = text.slice(bodyIndex + EMAIL_BODY_MARKER.length).trim();
  if (!subject || !body) return null;
  return { subject, body };
}
