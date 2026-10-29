import {
  BOT_CALLBACK_NAMESPACES,
  type CandidateSkill,
  DIGEST_MAX_SENDS_PER_DAY,
  type DigestMode,
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type Language,
  SENIORITY_LEVELS,
  sortSendTimes,
  WORK_FORMATS,
  type WorkFormat,
} from '@jobradar/shared';

import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';
import { ROLE_TITLES } from '../candidate/analysis';
import { GRADE_LABELS } from '../candidate/render';
import { isWorkLanguage, languageLabel, WORK_LANGUAGES } from '../matching/work-language';

/**
 * `/settings` and `/filters` in the bot (roadmap 5.3, 5.10), kept pure: what
 * each button does to the settings, and how each screen looks. The service
 * only loads, saves and sends.
 *
 * `/settings` is *when* vacancies arrive (delivery, times, quiet hours,
 * timezone, per send, language, pause); `/filters` is *which* ones: the role,
 * grade and skills the resume analysis filled in (the candidate profile, still
 * editable), and the hard filters (minimum fit, format, employment, salary,
 * sources).
 *
 * Callback data is `s:<action>[:<arg>]`, well inside Telegram's 64 bytes:
 *   s:menu / s:open:<screen>            show a screen
 *   s:mode / s:pause / s:lang           flip a two-way setting
 *   s:fmt:<v> / s:emp:<v> / s:src:<v>   toggle one entry of a list
 *   s:ms:<n> / s:cap:<n> / s:sal:<n>    set a number (0 = none)
 *   s:t:<HHMM-HHMM> / s:q:<HHMM-HHMM>   set times from a preset
 *   s:tz:<i>                            timezone preset by index
 *   s:role:<family> / s:grade:<level>   edit the candidate profile
 *   s:loc:<i> / s:loc:clear             drop one wanted place / all of them
 *   s:wl:<code> / s:wl:any              toggle a working language / accept any
 *   s:type:<step>                       ask for a typed value
 */

/** The candidate profile's part that picks vacancies, as /filters shows it. */
export interface ProfileFilters {
  role: string | null;
  grade: string | null;
  skills: CandidateSkill[];
  /** Matching waits for "All correct" (ADR-025). */
  confirmed: boolean;
}

export interface SettingsState {
  enabled: boolean;
  mode: DigestMode;
  sendTimes: string[];
  quietStart: string;
  quietEnd: string;
  minScore: number;
  instantMinScore: number;
  maxItems: number | null;
  workFormats: WorkFormat[];
  employmentTypes: EmploymentType[];
  minSalaryUsd: number | null;
  mutedSources: string[];
  /** Places an on-site or hybrid vacancy must be in; empty = anywhere. */
  locations: string[];
  /** Languages the user can work in; empty = any (v2.7.0, ADR-032). */
  workLanguages: string[];
  timezone: string;
  language: Language;
  /** Null until a resume has been analysed. */
  profile: ProfileFilters | null;
}

export type SettingsPatch = Partial<Omit<SettingsState, 'profile'>>;
export type ProfilePatch = Partial<Pick<ProfileFilters, 'role' | 'grade'>>;

export const SCREENS = [
  'main', 'fmt', 'emp', 'src', 'ms', 'cap', 'sal', 't', 'q', 'tz', 'flt', 'role', 'grade', 'loc', 'wl',
] as const;
export type Screen = (typeof SCREENS)[number];

/** The `/filters` screens: their "back" leads to the filters, not the settings. */
const FILTER_SCREENS: readonly Screen[] = ['flt', 'fmt', 'emp', 'src', 'ms', 'sal', 'role', 'grade', 'loc', 'wl'];

/** At most this many wanted places, each at most LOCATION_MAX_LENGTH characters. */
export const LOCATIONS_MAX = 10;
const LOCATION_MAX_LENGTH = 40;

/** Settings that can be typed in, besides the preset buttons. */
/** `sk` (skills) edits the candidate profile; the service parses it, not `parseTyped`. */
export const TYPE_STEPS = ['t', 'q', 'tz', 'sal', 'sk', 'loc'] as const;
export type TypeStep = (typeof TYPE_STEPS)[number];

export const SCORE_PRESETS = [40, 50, 60, 70, 80, 90];
export const CAP_PRESETS = [0, 5, 10, 20, 50];
export const SALARY_PRESETS = [0, 1500, 2500, 3500, 4500, 6000];
export const TIME_PRESETS = [['09:00'], ['10:00', '18:00'], ['09:00', '13:00', '19:00']];
export const QUIET_PRESETS = [
  ['22:00', '08:00'],
  ['23:00', '07:00'],
  ['00:00', '09:00'],
  ['00:00', '00:00'],
];
/** Short list of the audience's zones; anything else is typed (IANA name). */
export const TIMEZONE_PRESETS = [
  'Europe/Moscow',
  'Europe/Minsk',
  'Europe/Kyiv',
  'Europe/Warsaw',
  'Europe/Berlin',
  'Europe/London',
  'Asia/Tbilisi',
  'Asia/Yerevan',
  'Asia/Almaty',
  'Asia/Tashkent',
  'Asia/Dubai',
  'UTC',
];

/** Typed salaries above this are a typo or an annual figure; the floor is monthly. */
export const SALARY_MAX = 50_000;

export interface Decision {
  /** What to save; omitted when the press only navigates. */
  patch?: SettingsPatch;
  /** A candidate-profile edit made from /filters. */
  profilePatch?: ProfilePatch;
  /** The screen to show afterwards. */
  screen: Screen;
  /** Set when the press asks for a typed answer. */
  typeStep?: TypeStep;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function fromCompactTimes(raw: string | undefined): string[] {
  return (raw ?? '')
    .split('-')
    .filter((part) => /^\d{4}$/.test(part))
    .map((part) => `${part.slice(0, 2)}:${part.slice(2)}`);
}

export function compactTimes(times: string[]): string {
  return times.map((time) => time.replace(':', '')).join('-');
}

function isScreen(value: string | undefined): value is Screen {
  return (SCREENS as readonly string[]).includes(value ?? '');
}

function isTypeStep(value: string | undefined): value is TypeStep {
  return (TYPE_STEPS as readonly string[]).includes(value ?? '');
}

/** What one button press does. Unknown or malformed data shows the main menu. */
export function decide(state: SettingsState, parts: string[], sourceSlugs: string[]): Decision {
  const [, action, arg] = parts;
  const number = Number(arg);

  switch (action) {
    case 'open':
      return { screen: isScreen(arg) ? arg : 'main' };
    case 'mode':
      return { patch: { mode: state.mode === 'instant' ? 'scheduled' : 'instant' }, screen: 'main' };
    case 'pause':
      return { patch: { enabled: !state.enabled }, screen: 'main' };
    case 'lang':
      return { patch: { language: state.language === 'ru' ? 'en' : 'ru' }, screen: 'main' };
    case 'fmt':
      if (!(WORK_FORMATS as readonly string[]).includes(arg ?? '')) return { screen: 'fmt' };
      return { patch: { workFormats: toggle(state.workFormats, arg as WorkFormat) }, screen: 'fmt' };
    case 'emp':
      if (!(EMPLOYMENT_TYPES as readonly string[]).includes(arg ?? '')) return { screen: 'emp' };
      return {
        patch: { employmentTypes: toggle(state.employmentTypes, arg as EmploymentType) },
        screen: 'emp',
      };
    case 'src':
      if (!arg || !sourceSlugs.includes(arg)) return { screen: 'src' };
      return { patch: { mutedSources: toggle(state.mutedSources, arg) }, screen: 'src' };
    case 'ms':
      if (!Number.isInteger(number) || number < 0 || number > 100) return { screen: 'ms' };
      // The floor of the mode in use: instant judges a few at a time and is
      // stricter by default, scheduled weighs a whole window.
      return {
        patch: state.mode === 'instant' ? { instantMinScore: number } : { minScore: number },
        screen: 'flt',
      };
    case 'cap':
      if (!CAP_PRESETS.includes(number)) return { screen: 'cap' };
      return { patch: { maxItems: number === 0 ? null : number }, screen: 'main' };
    case 'sal':
      if (!SALARY_PRESETS.includes(number)) return { screen: 'sal' };
      return { patch: { minSalaryUsd: number === 0 ? null : number }, screen: 'flt' };
    case 't': {
      const times = fromCompactTimes(arg);
      const preset = TIME_PRESETS.find((p) => compactTimes(p) === compactTimes(times));
      if (!preset) return { screen: 't' };
      return { patch: { sendTimes: preset, mode: 'scheduled' }, screen: 'main' };
    }
    case 'q': {
      const [start, end] = fromCompactTimes(arg);
      const preset = QUIET_PRESETS.find(([s, e]) => s === start && e === end);
      if (!preset) return { screen: 'q' };
      return { patch: { quietStart: preset[0], quietEnd: preset[1] }, screen: 'main' };
    }
    case 'tz': {
      const zone = TIMEZONE_PRESETS[number];
      if (!Number.isInteger(number) || !zone) return { screen: 'tz' };
      return { patch: { timezone: zone }, screen: 'main' };
    }
    case 'loc': {
      if (arg === 'clear') return { patch: { locations: [] }, screen: 'loc' };
      const place = state.locations[number];
      if (!Number.isInteger(number) || place === undefined) return { screen: 'loc' };
      return { patch: { locations: state.locations.filter((_, i) => i !== number) }, screen: 'loc' };
    }
    case 'wl':
      if (arg === 'any') return { patch: { workLanguages: [] }, screen: 'wl' };
      if (!isWorkLanguage(arg)) return { screen: 'wl' };
      return { patch: { workLanguages: toggle(state.workLanguages, arg) }, screen: 'wl' };
    case 'role':
      if (!state.profile) return { screen: 'flt' };
      if (!arg || !ROLE_TITLES[arg]) return { screen: 'role' };
      return { profilePatch: { role: ROLE_TITLES[arg] }, screen: 'flt' };
    case 'grade':
      if (!state.profile) return { screen: 'flt' };
      if (!(SENIORITY_LEVELS as readonly string[]).includes(arg ?? '')) return { screen: 'grade' };
      return { profilePatch: { grade: arg }, screen: 'flt' };
    case 'type':
      if (!isTypeStep(arg)) return { screen: 'main' };
      if (arg === 'sk' && !state.profile) return { screen: 'flt' };
      // Steps share their letters with the screens they belong to; skills live on /filters.
      return { screen: arg === 'sk' ? 'flt' : arg, typeStep: arg };
    default:
      return { screen: 'main' };
  }
}

// ---------------------------------------------------------------------------
// Typed answers
// ---------------------------------------------------------------------------

const TIME = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;

function normalizeTime(raw: string): string | null {
  const match = TIME.exec(raw.trim());
  if (!match) return null;
  return `${match[1]!.padStart(2, '0')}:${match[2]}`;
}

/** An IANA zone the runtime knows, in its canonical spelling, or null. */
export function normalizeTimezone(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > 64) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The patch for a typed answer, or null when it does not parse. */
export function parseTyped(
  step: TypeStep,
  text: string,
  current: Pick<SettingsState, 'locations'> = { locations: [] },
): SettingsPatch | null {
  switch (step) {
    case 'loc': {
      // "Minsk, Poland" adds both; a place already listed is not added twice.
      const added = text
        .split(/[,;\n]+/)
        .map((place) => place.trim().replace(/\s+/g, ' '))
        .filter((place) => place.length > 0 && place.length <= LOCATION_MAX_LENGTH);
      if (added.length === 0) return null;
      const seen = new Set(current.locations.map((place) => place.toLowerCase()));
      const merged = [...current.locations];
      for (const place of added) {
        if (!seen.has(place.toLowerCase())) {
          seen.add(place.toLowerCase());
          merged.push(place);
        }
      }
      return { locations: merged.slice(0, LOCATIONS_MAX) };
    }
    case 't': {
      const parts = text.split(/[,;\s]+/).filter(Boolean);
      const times = parts.map(normalizeTime);
      if (times.length === 0 || times.some((t) => t === null)) return null;
      const unique = [...new Set(times as string[])];
      if (unique.length > DIGEST_MAX_SENDS_PER_DAY) return null;
      return { sendTimes: sortSendTimes(unique), mode: 'scheduled' };
    }
    case 'q': {
      const parts = text.split(/[-–—\s]+/).filter(Boolean);
      if (parts.length !== 2) return null;
      const [start, end] = parts.map(normalizeTime);
      if (!start || !end) return null;
      return { quietStart: start, quietEnd: end };
    }
    case 'tz': {
      const zone = normalizeTimezone(text);
      return zone ? { timezone: zone } : null;
    }
    case 'sal': {
      const digits = text.replace(/[\s$,.]|usd/gi, '');
      if (!/^\d+$/.test(digits)) return null;
      const value = Number(digits);
      if (value > SALARY_MAX) return null;
      return { minSalaryUsd: value === 0 ? null : value };
    }
    case 'sk':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const TEXT = {
  en: {
    title: '⚙️ <b>Settings</b>: when vacancies arrive',
    filtersTitle: '🎯 <b>Filters</b>: which vacancies arrive',
    fromResume: 'From the resume (tap to change)',
    manual: 'Your filters',
    noProfile: 'Role, grade and skills are filled in from your resume: send it as a PDF file (📎 → File).',
    unconfirmed: 'The profile is not confirmed yet, so nothing is sent: /resume → 👤 Profile → "✅ All correct".',
    role: 'Role',
    grade: 'Grade',
    skills: 'Skills',
    unknown: 'not set',
    filtersLine: 'Which vacancies: /filters',
    bFilters: '🎯 Filters',
    bSettings: '⚙️ Settings',
    bRole: '✏️ Role',
    bGrade: '✏️ Grade',
    bSkills: '✏️ Skills',
    roleHint: 'Your role: vacancies of another job family score low.',
    gradeHint: 'Your grade: vacancies two grades away score low.',
    delivery: 'Delivery',
    instant: 'as soon as posted',
    scheduled: 'at',
    quiet: 'quiet',
    quietOff: 'no quiet hours',
    timezone: 'Timezone',
    minScore: 'Minimum fit',
    cap: 'Per send',
    capNone: 'all that fit',
    format: 'Format',
    employment: 'Employment',
    salary: 'Minimum salary',
    perMonth: '/month',
    any: 'any',
    none: 'none',
    sourcesOff: 'Sources off',
    locations: 'Location',
    anywhere: 'anywhere',
    bLocation: '📍 Location',
    bAddPlace: '➕ Add a place',
    bClearPlaces: '🗑 Clear',
    locHint:
      'Places an on-site or hybrid vacancy must be in. Remote vacancies and those that do not say where always arrive. Tap a place to remove it.',
    workLanguages: 'Work languages',
    bWorkLanguages: '🗣 Languages',
    bAnyLanguage: 'Any language',
    wlHint:
      'Languages you can work in. A vacancy written in another language, or requiring one ("fluent German"), does not arrive; one whose language could not be told always does. None selected = any language.',
    language: 'Language',
    status: 'Status',
    active: 'active',
    paused: 'paused',
    bMode: (mode: DigestMode) => `📬 Delivery: ${mode === 'instant' ? 'instant' : 'scheduled'}`,
    bTimes: '🕒 Send times',
    bQuiet: '🔕 Quiet hours',
    bTz: '🌍 Timezone',
    bScore: '🎯 Minimum fit',
    bCap: '📦 Per send',
    bFormat: '💼 Format',
    bEmployment: '📝 Employment',
    bSalary: '💰 Salary',
    bSources: '📡 Sources',
    bLanguage: '🌐 Language: English',
    bSendNow: '📥 Send vacancies now',
    bResumeUpload: '📄 Resume',
    bPause: '⏸ Pause',
    bResume: '▶️ Resume',
    back: '← Back',
    typeIt: '✏️ Type it',
    fmtHint: 'Formats to receive. None selected = any.',
    empHint: 'Employment to receive. None selected = any.',
    srcHint: 'Tap a source to switch it off or on.',
    msHint: (mode: DigestMode) =>
      `Minimum fit for ${mode === 'instant' ? 'instant' : 'scheduled'} delivery. Below it a vacancy is not sent.`,
    capHint: 'At most this many vacancies per send.',
    salHint: 'Monthly minimum in USD. Only vacancies with a USD salary are compared; the rest still arrive.',
    tHint: 'Send times (switches delivery to scheduled).',
    qHint: 'No instant messages in this window; they arrive together when it ends.',
    tzHint: 'Your timezone, for send times and quiet hours.',
    ask: {
      t: 'Type up to 4 times, e.g. <code>09:00, 18:00</code>',
      q: 'Type the quiet window, e.g. <code>23:00-07:00</code>',
      tz: 'Type an IANA timezone, e.g. <code>Europe/Lisbon</code>',
      sal: 'Type the monthly minimum in USD, e.g. <code>3000</code>; 0 removes it',
      sk: 'Send your skills separated by commas, the main ones first, e.g. <code>React, TypeScript, Next.js</code>',
      loc: 'Type cities or countries separated by commas, e.g. <code>Minsk, Poland</code>',
    },
    badInput: 'Did not understand that. Try again, or /settings to go back.',
    saved: 'Saved.',
    formats: { remote: 'Remote', hybrid: 'Hybrid', onsite: 'Office' },
    employments: { full_time: 'Full-time', part_time: 'Part-time', freelance: 'Freelance' },
  },
  ru: {
    title: '⚙️ <b>Настройки</b>: когда присылать вакансии',
    filtersTitle: '🎯 <b>Фильтры</b>: какие вакансии присылать',
    fromResume: 'Из резюме (можно поменять)',
    manual: 'Твои фильтры',
    noProfile: 'Роль, грейд и навыки заполнятся из резюме: пришли его файлом PDF (📎 → «Файл»).',
    unconfirmed: 'Профиль ещё не подтверждён, поэтому вакансии не приходят: /resume → 👤 Профиль → «✅ Всё верно».',
    role: 'Роль',
    grade: 'Грейд',
    skills: 'Навыки',
    unknown: 'не указано',
    filtersLine: 'Какие вакансии: /filters',
    bFilters: '🎯 Фильтры',
    bSettings: '⚙️ Настройки',
    bRole: '✏️ Роль',
    bGrade: '✏️ Грейд',
    bSkills: '✏️ Навыки',
    roleHint: 'Твоя роль: вакансии другого направления получают низкий балл.',
    gradeHint: 'Твой грейд: вакансии на два грейда выше или ниже получают низкий балл.',
    delivery: 'Доставка',
    instant: 'сразу после публикации',
    scheduled: 'в',
    quiet: 'тишина',
    quietOff: 'без тихих часов',
    timezone: 'Часовой пояс',
    minScore: 'Минимальное совпадение',
    cap: 'За раз',
    capNone: 'все подходящие',
    format: 'Формат',
    employment: 'Занятость',
    salary: 'Минимальная зарплата',
    perMonth: '/мес',
    any: 'любой',
    none: 'нет',
    sourcesOff: 'Выключенные источники',
    locations: 'Локация',
    anywhere: 'любая',
    bLocation: '📍 Локация',
    bAddPlace: '➕ Добавить место',
    bClearPlaces: '🗑 Очистить',
    locHint:
      'Где должна быть вакансия в офисе или гибрид. Удалённые и те, где место не указано, приходят всегда. Нажми на место, чтобы убрать его.',
    workLanguages: 'Языки работы',
    bWorkLanguages: '🗣 Языки',
    bAnyLanguage: 'Любой язык',
    wlHint:
      'Языки, на которых ты можешь работать. Вакансия на другом языке или с обязательным знанием другого («fluent German») не придёт; если язык определить не удалось, придёт. Ничего не выбрано — любой язык.',
    language: 'Язык',
    status: 'Статус',
    active: 'активно',
    paused: 'на паузе',
    bMode: (mode: DigestMode) => `📬 Доставка: ${mode === 'instant' ? 'сразу' : 'по расписанию'}`,
    bTimes: '🕒 Время отправки',
    bQuiet: '🔕 Тихие часы',
    bTz: '🌍 Часовой пояс',
    bScore: '🎯 Мин. совпадение',
    bCap: '📦 За раз',
    bFormat: '💼 Формат',
    bEmployment: '📝 Занятость',
    bSalary: '💰 Зарплата',
    bSources: '📡 Источники',
    bLanguage: '🌐 Язык: Русский',
    bSendNow: '📥 Прислать вакансии сейчас',
    bResumeUpload: '📄 Резюме',
    bPause: '⏸ Пауза',
    bResume: '▶️ Возобновить',
    back: '← Назад',
    typeIt: '✏️ Ввести',
    fmtHint: 'Какие форматы присылать. Ничего не выбрано — любой.',
    empHint: 'Какую занятость присылать. Ничего не выбрано — любую.',
    srcHint: 'Нажми на источник, чтобы выключить или включить его.',
    msHint: (mode: DigestMode) =>
      `Минимальное совпадение для режима «${mode === 'instant' ? 'сразу' : 'по расписанию'}». Ниже — вакансия не придёт.`,
    capHint: 'Не больше стольких вакансий за одну отправку.',
    salHint: 'Минимум в месяц, в USD. Сравниваются только вакансии с зарплатой в долларах; остальные приходят как обычно.',
    tHint: 'Время отправки (переключает доставку на «по расписанию»).',
    qHint: 'В это время мгновенных сообщений нет; всё придёт одним сообщением после.',
    tzHint: 'Твой часовой пояс — для времени отправки и тихих часов.',
    ask: {
      t: 'Напиши до 4 значений времени, например <code>09:00, 18:00</code>',
      q: 'Напиши тихие часы, например <code>23:00-07:00</code>',
      tz: 'Напиши часовой пояс IANA, например <code>Europe/Lisbon</code>',
      sal: 'Напиши минимум в месяц в USD, например <code>3000</code>; 0 — убрать',
      sk: 'Пришли навыки через запятую, основные первыми, например <code>React, TypeScript, Next.js</code>',
      loc: 'Напиши города или страны через запятую, например <code>Минск, Польша</code>',
    },
    badInput: 'Не понял. Попробуй ещё раз или набери /settings, чтобы вернуться.',
    saved: 'Сохранено.',
    formats: { remote: 'Удалённо', hybrid: 'Гибрид', onsite: 'Офис' },
    employments: { full_time: 'Полная', part_time: 'Частичная', freelance: 'Фриланс' },
  },
} as const;

export function settingsText(lang: Language, key: 'badInput' | 'saved' | 'noProfile'): string {
  return TEXT[lang][key];
}

const ns = BOT_CALLBACK_NAMESPACES.settings;
/** `DIGEST_ACTION.now` in digest/render.ts, spelled here to keep this file free of the digest module. */
export const SEND_NOW_ACTION = 'n';
const button = (text: string, data: string) => ({ text, callbackData: `${ns}:${data}` });
const back = (lang: Language, screen: Screen = 'main') => [
  button(TEXT[lang].back, FILTER_SCREENS.includes(screen) ? 'open:flt' : 'menu'),
];
const mark = (on: boolean) => (on ? '✅ ' : '');

function rows<T>(items: T[], perRow: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) out.push(items.slice(i, i + perRow));
  return out;
}

function deliveryLine(state: SettingsState, lang: Language): string {
  const t = TEXT[lang];
  const quiet =
    state.quietStart === state.quietEnd ? t.quietOff : `${t.quiet} ${state.quietStart}–${state.quietEnd}`;
  return state.mode === 'instant'
    ? `${t.instant}, ${quiet}`
    : `${t.scheduled} ${state.sendTimes.join(', ')}`;
}

function summary(state: SettingsState, lang: Language): string {
  const t = TEXT[lang];
  const lines = [
    t.title,
    '',
    `${t.status}: ${state.enabled ? t.active : t.paused}`,
    `${t.delivery}: ${deliveryLine(state, lang)}`,
    `${t.timezone}: ${escapeHtml(state.timezone)}`,
    `${t.cap}: ${state.maxItems ?? t.capNone}`,
    `${t.language}: ${lang === 'ru' ? 'Русский' : 'English'}`,
    '',
    t.filtersLine,
  ];
  return lines.join('\n');
}

/** At most this many skills on the filters screen; the rest are counted. */
const SKILLS_SHOWN = 12;

function filtersSummary(state: SettingsState, lang: Language): string {
  const t = TEXT[lang];
  const floor = state.mode === 'instant' ? state.instantMinScore : state.minScore;
  const formats = state.workFormats.map((f) => t.formats[f]).join(', ') || t.any;
  const employment = state.employmentTypes.map((e) => t.employments[e]).join(', ') || t.any;
  const value = (v: string | null) => (v ? escapeHtml(v) : `<i>${t.unknown}</i>`);

  const profile = state.profile;
  const fromResume = profile
    ? [
        `<b>${t.fromResume}</b>`,
        `${t.role}: ${value(profile.role)}`,
        `${t.grade}: ${value(profile.grade ? (GRADE_LABELS[profile.grade]?.[lang] ?? profile.grade) : null)}`,
        `${t.skills}: ${value(skillsLine(profile.skills))}`,
        ...(profile.confirmed ? [] : ['', t.unconfirmed]),
      ]
    : [t.noProfile];
  return [
    t.filtersTitle,
    '',
    ...fromResume,
    '',
    `<b>${t.manual}</b>`,
    `${t.minScore}: ${floor}%`,
    `${t.format}: ${formats}`,
    `${t.locations}: ${escapeHtml(state.locations.join(', ')) || t.anywhere}`,
    `${t.workLanguages}: ${workLanguagesLine(state.workLanguages, lang) || t.any}`,
    `${t.employment}: ${employment}`,
    `${t.salary}: ${state.minSalaryUsd ? `$${state.minSalaryUsd}${t.perMonth}` : t.none}`,
    `${t.sourcesOff}: ${escapeHtml(state.mutedSources.join(', ')) || t.none}`,
  ].join('\n');
}

/** "English, Russian" in the account language, in the fixed order of the list. */
function workLanguagesLine(codes: string[], lang: Language): string {
  return WORK_LANGUAGES.filter((code) => codes.includes(code))
    .map((code) => languageLabel(code, lang))
    .join(', ');
}

/** "React, TypeScript, … +3": main skills first, as the profile stores them. */
function skillsLine(skills: CandidateSkill[]): string | null {
  if (skills.length === 0) return null;
  const sorted = [...skills.filter((s) => s.weight === 'core'), ...skills.filter((s) => s.weight !== 'core')];
  const shown = sorted.slice(0, SKILLS_SHOWN).map((s) => s.name).join(', ');
  return sorted.length > SKILLS_SHOWN ? `${shown} +${sorted.length - SKILLS_SHOWN}` : shown;
}

/** One screen: its text and its buttons. */
export function renderScreen(
  screen: Screen,
  state: SettingsState,
  sourceSlugs: string[],
  typeStep?: TypeStep,
): { text: string; keyboard: InlineKeyboard } {
  const lang = state.language;
  const t = TEXT[lang];

  if (typeStep) {
    // A typed place returns to the places list; the other filter answers to the filters.
    if (typeStep === 'loc') return { text: t.ask.loc, keyboard: [[button(t.back, 'open:loc')]] };
    const home: Screen = typeStep === 'sal' || typeStep === 'sk' ? 'flt' : 'main';
    return { text: t.ask[typeStep], keyboard: [back(lang, home)] };
  }

  switch (screen) {
    case 'fmt':
      return {
        text: t.fmtHint,
        keyboard: [
          WORK_FORMATS.map((f) => button(`${mark(state.workFormats.includes(f))}${t.formats[f]}`, `fmt:${f}`)),
          back(lang, screen),
        ],
      };
    case 'emp':
      return {
        text: t.empHint,
        keyboard: [
          EMPLOYMENT_TYPES.map((e) =>
            button(`${mark(state.employmentTypes.includes(e))}${t.employments[e]}`, `emp:${e}`),
          ),
          back(lang, screen),
        ],
      };
    case 'src':
      return {
        text: t.srcHint,
        keyboard: [
          ...rows(
            sourceSlugs.map((slug) =>
              button(`${state.mutedSources.includes(slug) ? '🚫 ' : '✅ '}${slug}`, `src:${slug}`),
            ),
            2,
          ),
          back(lang, screen),
        ],
      };
    case 'ms': {
      const current = state.mode === 'instant' ? state.instantMinScore : state.minScore;
      return {
        text: t.msHint(state.mode),
        keyboard: [
          ...rows(SCORE_PRESETS.map((n) => button(`${mark(n === current)}${n}%`, `ms:${n}`)), 3),
          back(lang, screen),
        ],
      };
    }
    case 'cap':
      return {
        text: t.capHint,
        keyboard: [
          CAP_PRESETS.map((n) =>
            button(`${mark((state.maxItems ?? 0) === n)}${n === 0 ? '∞' : n}`, `cap:${n}`),
          ),
          back(lang, screen),
        ],
      };
    case 'sal':
      return {
        text: t.salHint,
        keyboard: [
          ...rows(
            SALARY_PRESETS.map((n) =>
              button(`${mark((state.minSalaryUsd ?? 0) === n)}${n === 0 ? t.none : `$${n}`}`, `sal:${n}`),
            ),
            3,
          ),
          [button(t.typeIt, 'type:sal')],
          back(lang, screen),
        ],
      };
    case 't':
      return {
        text: t.tHint,
        keyboard: [
          ...TIME_PRESETS.map((times) => [
            button(
              `${mark(state.mode === 'scheduled' && compactTimes(times) === compactTimes(state.sendTimes))}${times.join(', ')}`,
              `t:${compactTimes(times)}`,
            ),
          ]),
          [button(t.typeIt, 'type:t')],
          back(lang, screen),
        ],
      };
    case 'q':
      return {
        text: t.qHint,
        keyboard: [
          ...rows(
            QUIET_PRESETS.map(([start, end]) =>
              button(
                `${mark(state.quietStart === start && state.quietEnd === end)}${start === end ? t.quietOff : `${start}–${end}`}`,
                `q:${compactTimes([start!, end!])}`,
              ),
            ),
            2,
          ),
          [button(t.typeIt, 'type:q')],
          back(lang, screen),
        ],
      };
    case 'tz':
      return {
        text: t.tzHint,
        keyboard: [
          ...rows(
            TIMEZONE_PRESETS.map((zone, index) =>
              button(`${mark(state.timezone === zone)}${zone}`, `tz:${index}`),
            ),
            2,
          ),
          [button(t.typeIt, 'type:tz')],
          back(lang, screen),
        ],
      };
    case 'role':
      return {
        text: t.roleHint,
        keyboard: [
          ...rows(
            Object.entries(ROLE_TITLES).map(([family, title]) =>
              button(`${mark(state.profile?.role === title)}${title}`, `role:${family}`),
            ),
            2,
          ),
          back(lang, screen),
        ],
      };
    case 'grade':
      return {
        text: t.gradeHint,
        keyboard: [
          ...rows(
            SENIORITY_LEVELS.map((level) =>
              button(`${mark(state.profile?.grade === level)}${GRADE_LABELS[level]?.[lang] ?? level}`, `grade:${level}`),
            ),
            3,
          ),
          back(lang, screen),
        ],
      };
    case 'loc':
      return {
        text: t.locHint,
        keyboard: [
          ...rows(
            state.locations.map((place, index) => button(`✖️ ${place}`, `loc:${index}`)),
            2,
          ),
          [
            ...(state.locations.length < LOCATIONS_MAX ? [button(t.bAddPlace, 'type:loc')] : []),
            ...(state.locations.length > 0 ? [button(t.bClearPlaces, 'loc:clear')] : []),
          ],
          back(lang, screen),
        ],
      };
    case 'wl':
      return {
        text: t.wlHint,
        keyboard: [
          ...rows(
            WORK_LANGUAGES.map((code) =>
              button(`${mark(state.workLanguages.includes(code))}${languageLabel(code, lang)}`, `wl:${code}`),
            ),
            2,
          ),
          [button(`${mark(state.workLanguages.length === 0)}${t.bAnyLanguage}`, 'wl:any')],
          back(lang, screen),
        ],
      };
    case 'flt':
      return {
        text: filtersSummary(state, lang),
        keyboard: [
          ...(state.profile
            ? [
                [button(t.bRole, 'open:role'), button(t.bGrade, 'open:grade')],
                [button(t.bSkills, 'type:sk')],
              ]
            : [[{ text: t.bResumeUpload, callbackData: `${BOT_CALLBACK_NAMESPACES.profile}:res` }]]),
          [button(t.bScore, 'open:ms'), button(t.bFormat, 'open:fmt')],
          [button(t.bLocation, 'open:loc'), button(t.bEmployment, 'open:emp')],
          [button(t.bSalary, 'open:sal'), button(t.bWorkLanguages, 'open:wl')],
          [button(t.bSources, 'open:src'), button(t.bSettings, 'menu')],
        ],
      };
    case 'main':
    default:
      return {
        text: summary(state, lang),
        keyboard: [
          // Two per row (roadmap 5.7): three made Telegram cut the labels on a phone.
          [button(t.bMode(state.mode), 'mode'), button(t.bTimes, 'open:t')],
          [button(t.bQuiet, 'open:q'), button(t.bTz, 'open:tz')],
          [button(t.bCap, 'open:cap'), button(state.enabled ? t.bPause : t.bResume, 'pause')],
          [button(t.bLanguage, 'lang')],
          // "Which vacancies" lives on its own screen (roadmap 5.10); the resume
          // button is handled by the candidate module (`p:res`), which owns it.
          [
            button(t.bFilters, 'open:flt'),
            { text: t.bResumeUpload, callbackData: `${BOT_CALLBACK_NAMESPACES.profile}:res` },
          ],
          // Handled by the digest module (`d:n`), which owns sending.
          [{ text: t.bSendNow, callbackData: `${BOT_CALLBACK_NAMESPACES.digest}:${SEND_NOW_ACTION}` }],
        ],
      };
  }
}
