import {
  BOT_CALLBACK_NAMESPACES,
  CANDIDATE_SKILLS_MAX,
  type CandidateSkill,
  ENGLISH_LEVELS,
  type Language,
  type ResumeEvaluation,
  SENIORITY_LEVELS,
} from '@jobradar/shared';

import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';
import { ROLE_TITLES } from './analysis';

/**
 * Messages and keyboards of the resume → profile dialog (ADR-025 §1–2). Pure:
 * HTML strings and button rows, escaped here, so the service only sends them.
 */

const NS = BOT_CALLBACK_NAMESPACES.profile;

const TEXT = {
  en: {
    reading: 'Reading your resume…',
    notPdf: 'Please send the resume as a PDF file.',
    tooBig: 'The file is larger than 5 MB. Please send a smaller PDF.',
    noText: 'I could not read any text in this PDF. It may be a scan; please send a PDF with selectable text.',
    downloadFailed: 'Could not download the file from Telegram. Please send it again.',
    limit: 'You have used all {n} resume analyses for the last {days} days. Your current profile stays as it is.',
    evaluationTitle: 'Resume review',
    strengths: 'Works well',
    gaps: 'Missing or weak',
    suggestions: 'What to add or rewrite',
    fallbackNote: 'The AI analysis is unavailable right now, so I built the profile from the words in your resume. Check it carefully, or press "Analyse again" later.',
    profileTitle: 'Your profile',
    role: 'Role',
    grade: 'Grade',
    years: 'Experience',
    yearsValue: '{n} yr',
    skills: 'Skills',
    core: 'main',
    familiar: 'also',
    english: 'English',
    location: 'Location',
    salary: 'Desired salary',
    unknown: 'not set',
    confirmHint: 'Is everything correct? Vacancies are picked by this profile.',
    ok: '✅ All correct',
    editRole: 'Role',
    editGrade: 'Grade',
    editEnglish: 'English',
    editSkills: 'Skills',
    retry: '🔄 Analyse again',
    back: '← Back',
    confirmed:
      'Profile saved. New vacancies that fit it will arrive here as they are posted, quiet hours 22:00–08:00. /settings changes delivery, filters and timezone.',
    askSkills: 'Send your skills separated by commas, the main ones first. Example: React, TypeScript, Next.js, Redux',
    badSkills: 'I did not find any skills in that. Send them separated by commas, e.g. React, TypeScript.',
    noProfile: 'Send your resume as a PDF first.',
    pickGrade: 'Pick your grade:',
    pickEnglish: 'Pick your English level:',
    pickRole: 'Pick your role:',
  },
  ru: {
    reading: 'Читаю резюме…',
    notPdf: 'Пришли резюме файлом PDF.',
    tooBig: 'Файл больше 5 МБ. Пришли PDF поменьше.',
    noText: 'Не удалось прочитать текст в этом PDF. Возможно, это скан; пришли PDF, в котором текст можно выделить.',
    downloadFailed: 'Не удалось скачать файл из Telegram. Пришли его ещё раз.',
    limit: 'Ты использовал все {n} анализа резюме за последние {days} дней. Текущий профиль остаётся как есть.',
    evaluationTitle: 'Разбор резюме',
    strengths: 'Что хорошо',
    gaps: 'Чего не хватает',
    suggestions: 'Что дописать или переписать',
    fallbackNote: 'AI-анализ сейчас недоступен, поэтому я собрал профиль по словам из резюме. Проверь его внимательно или нажми «Проанализировать снова» позже.',
    profileTitle: 'Твой профиль',
    role: 'Роль',
    grade: 'Грейд',
    years: 'Опыт',
    yearsValue: '{n} г.',
    skills: 'Навыки',
    core: 'основные',
    familiar: 'ещё',
    english: 'Английский',
    location: 'Локация',
    salary: 'Желаемая зарплата',
    unknown: 'не указано',
    confirmHint: 'Всё верно? По этому профилю подбираются вакансии.',
    ok: '✅ Всё верно',
    editRole: 'Роль',
    editGrade: 'Грейд',
    editEnglish: 'Английский',
    editSkills: 'Навыки',
    retry: '🔄 Проанализировать снова',
    back: '← Назад',
    confirmed:
      'Профиль сохранён. Новые подходящие вакансии будут приходить сюда сразу после публикации, ночью (22:00–08:00) тишина. /settings — доставка, фильтры и часовой пояс.',
    askSkills: 'Пришли навыки через запятую, основные первыми. Пример: React, TypeScript, Next.js, Redux',
    badSkills: 'Не нашёл навыков в сообщении. Пришли их через запятую, например: React, TypeScript.',
    noProfile: 'Сначала пришли резюме в PDF.',
    pickGrade: 'Выбери грейд:',
    pickEnglish: 'Выбери уровень английского:',
    pickRole: 'Выбери роль:',
  },
} as const;

export type ProfileTextKey = keyof (typeof TEXT)['en'];

export function profileText(
  lang: Language,
  key: ProfileTextKey,
  vars: Record<string, string | number> = {},
): string {
  let text: string = TEXT[lang]?.[key] ?? TEXT.en[key];
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

const GRADE_LABELS: Record<string, { en: string; ru: string }> = {
  intern: { en: 'Intern', ru: 'Стажёр' },
  junior: { en: 'Junior', ru: 'Junior' },
  middle: { en: 'Middle', ru: 'Middle' },
  senior: { en: 'Senior', ru: 'Senior' },
  lead: { en: 'Lead', ru: 'Lead' },
};

export function evaluationMessage(lang: Language, evaluation: ResumeEvaluation): string {
  const section = (key: 'strengths' | 'gaps' | 'suggestions', items: string[]) =>
    items.length === 0
      ? ''
      : `\n\n<b>${escapeHtml(profileText(lang, key))}</b>\n${items.map((i) => `• ${escapeHtml(i)}`).join('\n')}`;
  return (
    `<b>${escapeHtml(profileText(lang, 'evaluationTitle'))}</b>` +
    section('strengths', evaluation.strengths) +
    section('gaps', evaluation.gaps) +
    section('suggestions', evaluation.suggestions)
  );
}

/** The profile fields the card shows; a subset of the `candidate_profiles` row. */
export interface ProfileView {
  role: string | null;
  grade: string | null;
  years: number | null;
  skills: CandidateSkill[];
  english: string | null;
  location: string | null;
  salaryUsd: number | null;
}

export function profileCard(
  lang: Language,
  profile: ProfileView,
  options: { fallback?: boolean } = {},
): { text: string; keyboard: InlineKeyboard } {
  const unknown = profileText(lang, 'unknown');
  const line = (key: ProfileTextKey, value: string | null) =>
    `${escapeHtml(profileText(lang, key))}: ${value ? escapeHtml(value) : `<i>${escapeHtml(unknown)}</i>`}`;
  const core = profile.skills.filter((s) => s.weight === 'core').map((s) => s.name);
  const familiar = profile.skills.filter((s) => s.weight === 'familiar').map((s) => s.name);
  const skills = [
    core.length ? `${profileText(lang, 'core')}: ${core.join(', ')}` : '',
    familiar.length ? `${profileText(lang, 'familiar')}: ${familiar.join(', ')}` : '',
  ].filter(Boolean);

  const lines = [
    `<b>${escapeHtml(profileText(lang, 'profileTitle'))}</b>`,
    line('role', profile.role),
    line('grade', profile.grade ? (GRADE_LABELS[profile.grade]?.[lang] ?? profile.grade) : null),
    line(
      'years',
      profile.years !== null ? profileText(lang, 'yearsValue', { n: profile.years }) : null,
    ),
    line('skills', skills.length ? skills.join('; ') : null),
    line('english', profile.english),
    line('location', profile.location),
    line('salary', profile.salaryUsd !== null ? `$${profile.salaryUsd}` : null),
  ];
  const note = options.fallback ? `\n\n<i>${escapeHtml(profileText(lang, 'fallbackNote'))}</i>` : '';
  const text = `${lines.join('\n')}${note}\n\n${escapeHtml(profileText(lang, 'confirmHint'))}`;

  const keyboard: InlineKeyboard = [
    [{ text: profileText(lang, 'ok'), callbackData: `${NS}:ok` }],
    [
      { text: profileText(lang, 'editRole'), callbackData: `${NS}:r` },
      { text: profileText(lang, 'editGrade'), callbackData: `${NS}:g` },
    ],
    [
      { text: profileText(lang, 'editEnglish'), callbackData: `${NS}:e` },
      { text: profileText(lang, 'editSkills'), callbackData: `${NS}:s` },
    ],
    [{ text: profileText(lang, 'retry'), callbackData: `${NS}:retry` }],
  ];
  return { text, keyboard };
}

/** Picker rows for one field: `p:<field>:<value>`, plus a way back to the card. */
export function pickerKeyboard(lang: Language, field: 'g' | 'e' | 'r'): InlineKeyboard {
  const options: { text: string; value: string }[] =
    field === 'g'
      ? SENIORITY_LEVELS.map((level) => ({ text: GRADE_LABELS[level]![lang], value: level }))
      : field === 'e'
        ? ENGLISH_LEVELS.map((level) => ({ text: level, value: level }))
        : Object.entries(ROLE_TITLES).map(([family, title]) => ({ text: title, value: family }));
  const rows: InlineKeyboard = [];
  const perRow = field === 'r' ? 2 : 3;
  for (let i = 0; i < options.length; i += perRow) {
    rows.push(
      options
        .slice(i, i + perRow)
        .map((o) => ({ text: o.text, callbackData: `${NS}:${field}:${o.value}` })),
    );
  }
  rows.push([{ text: profileText(lang, 'back'), callbackData: `${NS}:card` }]);
  return rows;
}

/**
 * "React, TypeScript; Next.js" → skills, main ones first: the first
 * six become `core`, the rest `familiar`, matching how people list them.
 */
export function parseSkillsInput(input: string): CandidateSkill[] {
  const seen = new Set<string>();
  const names = input
    .split(/[,;\n]+/)
    .map((s) => s.trim().replace(/^[-•*]\s*/, ''))
    .filter((s) => s.length > 0 && s.length <= 40)
    .filter((s) => {
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, CANDIDATE_SKILLS_MAX);
  return names.map((name, index) => ({ name, weight: index < 6 ? 'core' : 'familiar' }));
}
