import { type Language } from '@jobradar/shared';

/**
 * Candidate titles and reasons are generated server-side, because a title that
 * is added to a plan is *persisted* as text — it cannot be re-translated later.
 * The language is the caller's account language (ADR-014), exactly like the AI
 * sections. Kept as a tiny local map: this is a handful of strings, not a
 * reason to pull an i18n runtime into the API (ADR-001).
 */

const STRINGS = {
  en: {
    'followup.title': 'Follow up: {company}',
    'followup.reason': 'No answer for {days} days ({stage})',
    'topic.title': 'Prep: {topic}',
    'topic.reason': 'Open topic in your interview plan',
    'apply.title': 'Apply: {title} — {company}',
    'apply.reason': 'Matches your profile ({score}%)',
    'debt.title': '{title}',
    'debt.reason': 'Unfinished since {date} — carried {count}×',
  },
  ru: {
    'followup.title': 'Напомнить о себе: {company}',
    'followup.reason': 'Нет ответа {days} дн. ({stage})',
    'topic.title': 'Подготовка: {topic}',
    'topic.reason': 'Незакрытая тема в плане подготовки',
    'apply.title': 'Откликнуться: {title} — {company}',
    'apply.reason': 'Подходит под профиль ({score}%)',
    'debt.title': '{title}',
    'debt.reason': 'Не сделано с {date} — переносится {count}×',
  },
} as const;

export type PlannerLabelKey = keyof (typeof STRINGS)['en'];

export function plannerLabel(
  lang: Language,
  key: PlannerLabelKey,
  vars?: Record<string, string | number>,
): string {
  const template = STRINGS[lang]?.[key] ?? STRINGS.en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}
