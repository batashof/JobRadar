import {
  BOT_CALLBACK_NAMESPACES,
  CANDIDATE_SKILLS_MAX,
  canonicalSkill,
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
    editRole: '💼 Role',
    editGrade: '📈 Grade',
    editEnglish: '🔤 English',
    editSkills: '🧠 Skills',
    editYears: '⏳ Experience',
    retry: '🔄 Analyse again',
    back: '⬅️ Back',
    confirmed:
      'Profile saved. New vacancies that fit it will arrive here as they are posted, quiet hours 22:00–08:00. Which vacancies to receive and when: /settings.',
    askSkills: 'Send your skills separated by commas, the main ones first. Example: React, TypeScript, Next.js, Redux',
    badSkills: 'I did not find any skills in that. Send them separated by commas, e.g. React, TypeScript.',
    askSkillsEdit:
      'Now: {skills}\n\nTo add or remove one, send +Skill or -Skill, e.g. +JavaScript, -jQuery (an added one counts as main). To replace the whole list, send it separated by commas, the main ones first.',
    askYears: 'How many years of professional experience do you have? Send a number, e.g. 8.',
    badYears: 'Send the number of years as digits, from 0 to 50, e.g. 8.',
    noProfile: 'Send your resume as a PDF file first (📎 → File).',
    pickGrade: 'Pick your grade:',
    pickEnglish: 'Pick your English level:',
    pickRole: 'Pick your role:',
    resumeNone:
      '📄 No resume yet.\n\nHow to add it: tap 📎 next to the message field → File → pick your resume as a PDF (up to 5 MB) and send it here. I will read it and build the profile vacancies are picked by.',
    resumeCurrent: '📄 Your resume: <b>{file}</b>, uploaded {date}.',
    resumeReplace:
      'To replace it, send a new PDF here the same way (📎 → File). The profile is rebuilt from the new resume and waits for your confirmation.',
    resumeLimit: 'Resume analyses: up to {n} per {days} days.',
    bProfile: '👤 Profile',
    bSetup: '🧭 First steps',
    setupTitle: 'First steps in JobRadar',
    setupResumeDone: 'Resume: {file}',
    setupResumeTodo: 'Resume: send it here as a PDF file (📎 → File)',
    setupResumeManual: 'Resume: not needed, the profile is set by hand',
    setupProfileDone: 'Profile confirmed',
    setupProfileCheck: 'Profile: check the card and press "✅ All correct"',
    setupProfileWait: 'Profile: appears after the resume',
    setupDelivery: 'Delivery: new vacancies arrive as soon as they are posted, silent 22:00–08:00. Change it in ⚙️ Settings.',
    setupFilters: 'Filters: role, grade and skills come from the profile; work format, location, salary and minimum fit are up to you. All in 🎯 Filters.',
    setupHint: 'Go through the buttons below in order.',
    bResume: '📄 Resume',
    bSettings: '⚙️ Settings',
    bFilters: '🎯 Filters',
    bSendNow: '📥 Send vacancies now',
    bManual: '✍️ Without a resume',
    manualReplace:
      'Your profile was built from your resume. Setting it by hand replaces it; the resume stays, and sending it again rebuilds the profile from it. Continue?',
    manualYes: '✍️ Set by hand',
    manualKeep: '↩️ Keep the current one',
    wizRole:
      'Without a resume: four questions, and vacancies are picked by your answers. Nothing personal is asked.\n\nStep 1 of 4: pick your role.',
    wizGrade: 'Step 2 of 4: pick your grade.',
    wizSkills: 'Step 3 of 4: send your skills separated by commas, the main ones first. Example: React, TypeScript, Next.js, Redux',
    wizEnglish: 'Step 4 of 4: your English level.',
    skip: '⏭ Skip',
    manualNote: 'Set by hand, without a resume. Work format, location and the vacancy\'s language are in /settings → 🎯 Filters.',
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
    editRole: '💼 Роль',
    editGrade: '📈 Грейд',
    editEnglish: '🔤 Английский',
    editSkills: '🧠 Навыки',
    editYears: '⏳ Опыт',
    retry: '🔄 Проанализировать снова',
    back: '⬅️ Назад',
    confirmed:
      'Профиль сохранён. Новые подходящие вакансии будут приходить сюда сразу после публикации, ночью (22:00–08:00) тишина. Какие вакансии присылать и когда: /settings.',
    askSkills: 'Пришли навыки через запятую, основные первыми. Пример: React, TypeScript, Next.js, Redux',
    badSkills: 'Не нашёл навыков в сообщении. Пришли их через запятую, например: React, TypeScript.',
    askSkillsEdit:
      'Сейчас: {skills}\n\nЧтобы добавить или убрать навык, пришли +Навык или -Навык, например: +JavaScript, -jQuery (добавленный считается основным). Чтобы заменить весь список, пришли его через запятую, основные первыми.',
    askYears: 'Сколько лет у тебя коммерческого опыта? Пришли число, например 8.',
    badYears: 'Пришли число лет цифрами, от 0 до 50, например 8.',
    noProfile: 'Сначала пришли резюме файлом PDF (📎 → «Файл»).',
    pickGrade: 'Выбери грейд:',
    pickEnglish: 'Выбери уровень английского:',
    pickRole: 'Выбери роль:',
    resumeNone:
      '📄 Резюме ещё не загружено.\n\nКак добавить: нажми 📎 рядом с полем ввода → «Файл» → выбери резюме в PDF (до 5 МБ) и отправь сюда. Я прочитаю его и соберу профиль, по которому подбираются вакансии.',
    resumeCurrent: '📄 Твоё резюме: <b>{file}</b>, загружено {date}.',
    resumeReplace:
      'Чтобы заменить, пришли сюда новый PDF тем же способом (📎 → «Файл»). Профиль соберётся заново по новому резюме и будет ждать твоего подтверждения.',
    resumeLimit: 'Анализов резюме: до {n} за {days} дней.',
    bProfile: '👤 Профиль',
    bSetup: '🧭 Первые шаги',
    setupTitle: 'Первые шаги в JobRadar',
    setupResumeDone: 'Резюме: {file}',
    setupResumeTodo: 'Резюме: пришли его сюда файлом PDF (📎 → «Файл»)',
    setupResumeManual: 'Резюме: не нужно, профиль задан вручную',
    setupProfileDone: 'Профиль подтверждён',
    setupProfileCheck: 'Профиль: проверь карточку и нажми «✅ Всё верно»',
    setupProfileWait: 'Профиль: появится после резюме',
    setupDelivery: 'Доставка: новые вакансии приходят сразу после публикации, ночью (22:00–08:00) тишина. Поменять можно в ⚙️ Настройках.',
    setupFilters: 'Фильтры: роль, грейд и навыки берутся из профиля; формат работы, локация, зарплата и минимальное совпадение — по желанию. Всё в 🎯 Фильтрах.',
    setupHint: 'Пройди кнопки ниже по порядку.',
    bResume: '📄 Резюме',
    bSettings: '⚙️ Настройки',
    bFilters: '🎯 Фильтры',
    bSendNow: '📥 Прислать вакансии сейчас',
    bManual: '✍️ Без резюме',
    manualReplace:
      'Твой профиль собран из резюме. Если задать его вручную, он заменится; резюме останется, и если прислать его снова, профиль соберётся по нему. Продолжить?',
    manualYes: '✍️ Задать вручную',
    manualKeep: '↩️ Оставить текущий',
    wizRole:
      'Без резюме: четыре вопроса, и вакансии подбираются по твоим ответам. Ничего личного не спрашиваю.\n\nШаг 1 из 4: выбери роль.',
    wizGrade: 'Шаг 2 из 4: выбери грейд.',
    wizSkills: 'Шаг 3 из 4: пришли навыки через запятую, основные первыми. Пример: React, TypeScript, Next.js, Redux',
    wizEnglish: 'Шаг 4 из 4: уровень английского.',
    skip: '⏭ Пропустить',
    manualNote: 'Задан вручную, без резюме. Формат работы, локация и язык вакансии — в /settings → 🎯 Фильтры.',
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

/** One icon per grade and per role (roadmap 5.20): every button carries one. */
export const GRADE_ICONS: Record<string, string> = {
  intern: '🌱',
  junior: '🐣',
  middle: '🧑‍💻',
  senior: '🦉',
  lead: '👑',
};

export const ROLE_ICONS: Record<string, string> = {
  frontend: '🎨',
  fullstack: '🧩',
  backend: '🛠',
  mobile: '📱',
  devops: '🚢',
  qa: '🐞',
  data: '🗄',
  design: '✒️',
  product: '🧭',
  analytics: '📊',
};

export const GRADE_LABELS: Record<string, { en: string; ru: string }> = {
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
  options: { fallback?: boolean; manual?: boolean } = {},
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
  const noteKey: ProfileTextKey | null = options.manual ? 'manualNote' : options.fallback ? 'fallbackNote' : null;
  const note = noteKey ? `\n\n<i>${escapeHtml(profileText(lang, noteKey))}</i>` : '';
  const text = `${lines.join('\n')}${note}\n\n${escapeHtml(profileText(lang, 'confirmHint'))}`;

  const keyboard: InlineKeyboard = [
    [{ text: profileText(lang, 'ok'), callbackData: `${NS}:ok` }],
    [
      { text: profileText(lang, 'editRole'), callbackData: `${NS}:r` },
      { text: profileText(lang, 'editGrade'), callbackData: `${NS}:g` },
    ],
    [
      { text: profileText(lang, 'editYears'), callbackData: `${NS}:y` },
      { text: profileText(lang, 'editEnglish'), callbackData: `${NS}:e` },
    ],
    [
      { text: profileText(lang, 'editSkills'), callbackData: `${NS}:s` },
      // A profile set by hand has no resume to analyse again.
      ...(options.manual ? [] : [{ text: profileText(lang, 'retry'), callbackData: `${NS}:retry` }]),
    ],
  ];
  return { text, keyboard };
}

/**
 * Picker rows for one field: `p:<field>:<value>`, plus a way back to the card.
 * In the no-resume wizard (ADR-034) the buttons are `p:w<field>:<value>`, each
 * pick leads to the next step, and English can be skipped instead.
 */
export function pickerKeyboard(
  lang: Language,
  field: 'g' | 'e' | 'r',
  options: { wizard?: boolean } = {},
): InlineKeyboard {
  const action = options.wizard ? `w${field}` : field;
  const values: { text: string; value: string }[] =
    field === 'g'
      ? SENIORITY_LEVELS.map((level) => ({
          text: `${GRADE_ICONS[level] ?? ''} ${GRADE_LABELS[level]![lang]}`.trim(),
          value: level,
        }))
      : field === 'e'
        ? ENGLISH_LEVELS.map((level) => ({ text: `🗣 ${level}`, value: level }))
        : Object.entries(ROLE_TITLES).map(([family, title]) => ({
            text: `${ROLE_ICONS[family] ?? ''} ${title}`.trim(),
            value: family,
          }));
  const rows: InlineKeyboard = [];
  // Two per row everywhere (roadmap 5.20).
  const perRow = 2;
  for (let i = 0; i < values.length; i += perRow) {
    rows.push(
      values
        .slice(i, i + perRow)
        .map((o) => ({ text: o.text, callbackData: `${NS}:${action}:${o.value}` })),
    );
  }
  if (!options.wizard) rows.push([{ text: profileText(lang, 'back'), callbackData: `${NS}:card` }]);
  else if (field === 'e') rows.push([{ text: profileText(lang, 'skip'), callbackData: `${NS}:we:-` }]);
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
    .map((s) => s.trim().replace(/^[-+•*]\s*/, ''))
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

/**
 * A typed answer to "✏️ Skills" on an existing list: "+JavaScript, -jQuery"
 * adds and removes (an added skill joins the main ones, it was missing from
 * them), anything else replaces the list as `parseSkillsInput` reads it.
 */
export function editSkillsInput(current: CandidateSkill[], input: string): CandidateSkill[] {
  const items = input
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0 || !items.every((s) => /^[+-]/.test(s))) return parseSkillsInput(input);

  const key = (name: string) => canonicalSkill(name);
  const removed = new Set(
    items.filter((s) => s.startsWith('-')).map((s) => key(s.slice(1).trim())),
  );
  const kept = current.filter((skill) => !removed.has(key(skill.name)));
  const seen = new Set(kept.map((skill) => key(skill.name)));
  const added: CandidateSkill[] = [];
  for (const item of items.filter((s) => s.startsWith('+'))) {
    const name = item.slice(1).trim();
    if (!name || name.length > 40 || seen.has(key(name))) continue;
    seen.add(key(name));
    added.push({ name, weight: 'core' });
  }
  const core = kept.filter((s) => s.weight === 'core');
  const familiar = kept.filter((s) => s.weight !== 'core');
  return [...core, ...added, ...familiar].slice(0, CANDIDATE_SKILLS_MAX);
}

/** "8", "8+", "8 лет" → 8; null when it is not a plausible number of years. */
export function parseYearsInput(input: string): number | null {
  const match = /^\s*(\d{1,2})\s*\+?\s*(?:\p{L}+\.?)?\s*$/u.exec(input);
  if (!match) return null;
  const n = Number(match[1]);
  return n <= 50 ? n : null;
}

/** The active resume as /resume and /setup show it. */
export interface ResumeView {
  filename: string;
  uploadedAt: Date;
}

const btn = (text: string, data: string) => ({ text, callbackData: data });

/**
 * `/resume` (and "📄 Resume" in /settings): what is uploaded and how to add or
 * replace it. Telegram has no button that opens the file picker, so the
 * screen says where the paperclip is.
 */
export function resumeScreen(
  lang: Language,
  resume: ResumeView | null,
  options: { hasProfile: boolean; limit?: { n: number; days: number } },
): { text: string; keyboard: InlineKeyboard } {
  const parts = resume
    ? [
        profileText(lang, 'resumeCurrent', {
          file: escapeHtml(resume.filename),
          date: resume.uploadedAt.toISOString().slice(0, 10),
        }),
        escapeHtml(profileText(lang, 'resumeReplace')),
        ...(options.limit ? [escapeHtml(profileText(lang, 'resumeLimit', options.limit))] : []),
      ]
    : [escapeHtml(profileText(lang, 'resumeNone'))];
  const row = [
    ...(options.hasProfile ? [btn(profileText(lang, 'bProfile'), `${NS}:card`)] : []),
    btn(profileText(lang, 'bSetup'), `${NS}:setup`),
  ];
  // "✍️ Without a resume" (`p:man`) is hidden for now (roadmap 5.20); the flow still works.
  const keyboard: InlineKeyboard = [row];
  return { text: parts.join('\n\n'), keyboard };
}

/**
 * `/setup`: the new user's checklist (roadmap 5.9). Each line says where the
 * account stands; the buttons open the resume screen, the profile card,
 * /filters and /settings, so one message walks the whole setup.
 */
export function setupScreen(
  lang: Language,
  state: { resume: ResumeView | null; profile: 'none' | 'unconfirmed' | 'confirmed'; manual?: boolean },
): { text: string; keyboard: InlineKeyboard } {
  const t = (key: ProfileTextKey, vars: Record<string, string | number> = {}) =>
    escapeHtml(profileText(lang, key, vars));
  const mark = (done: boolean) => (done ? '✅' : '⬜');
  // A profile set by hand (ADR-034) makes the resume step done without a file.
  const resumeDone = state.resume !== null || state.manual === true;
  const resumeLine = state.resume
    ? t('setupResumeDone', { file: state.resume.filename })
    : state.manual
      ? t('setupResumeManual')
      : t('setupResumeTodo');
  const profileLine =
    state.profile === 'confirmed'
      ? t('setupProfileDone')
      : state.profile === 'unconfirmed'
        ? t('setupProfileCheck')
        : t('setupProfileWait');
  const text = [
    `<b>${t('setupTitle')}</b>`,
    '',
    `1. ${mark(resumeDone)} ${resumeLine}`,
    `2. ${mark(state.profile === 'confirmed')} ${profileLine}`,
    `3. ${t('setupDelivery')}`,
    `4. ${t('setupFilters')}`,
    '',
    t('setupHint'),
  ].join('\n');

  const s = BOT_CALLBACK_NAMESPACES.settings;
  const keyboard: InlineKeyboard = [
    [
      btn(profileText(lang, 'bResume'), `${NS}:res`),
      ...(state.profile !== 'none' ? [btn(profileText(lang, 'bProfile'), `${NS}:card`)] : []),
    ],
    [btn(profileText(lang, 'bFilters'), `${s}:open:flt`), btn(profileText(lang, 'bSettings'), `${s}:menu`)],
    ...(state.profile === 'confirmed'
      ? [[btn(profileText(lang, 'bSendNow'), `${BOT_CALLBACK_NAMESPACES.digest}:n`)]]
      : []),
  ];
  return { text, keyboard };
}
