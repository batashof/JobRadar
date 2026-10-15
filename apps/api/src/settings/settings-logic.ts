import {
  BOT_CALLBACK_NAMESPACES,
  DIGEST_MAX_SENDS_PER_DAY,
  type DigestMode,
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type Language,
  sortSendTimes,
  WORK_FORMATS,
  type WorkFormat,
} from '@jobradar/shared';

import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';

/**
 * `/settings` in the bot (roadmap 5.3), kept pure: what each button does to the
 * settings, and how each screen looks. The service only loads, saves and sends.
 *
 * Callback data is `s:<action>[:<arg>]`, well inside Telegram's 64 bytes:
 *   s:menu / s:open:<screen>            show a screen
 *   s:mode / s:pause / s:lang           flip a two-way setting
 *   s:fmt:<v> / s:emp:<v> / s:src:<v>   toggle one entry of a list
 *   s:ms:<n> / s:cap:<n> / s:sal:<n>    set a number (0 = none)
 *   s:t:<HHMM-HHMM> / s:q:<HHMM-HHMM>   set times from a preset
 *   s:tz:<i>                            timezone preset by index
 *   s:type:<step>                       ask for a typed value
 */

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
  timezone: string;
  language: Language;
}

export type SettingsPatch = Partial<SettingsState>;

export const SCREENS = ['main', 'fmt', 'emp', 'src', 'ms', 'cap', 'sal', 't', 'q', 'tz'] as const;
export type Screen = (typeof SCREENS)[number];

/** Settings that can be typed in, besides the preset buttons. */
export const TYPE_STEPS = ['t', 'q', 'tz', 'sal'] as const;
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
        screen: 'main',
      };
    case 'cap':
      if (!CAP_PRESETS.includes(number)) return { screen: 'cap' };
      return { patch: { maxItems: number === 0 ? null : number }, screen: 'main' };
    case 'sal':
      if (!SALARY_PRESETS.includes(number)) return { screen: 'sal' };
      return { patch: { minSalaryUsd: number === 0 ? null : number }, screen: 'main' };
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
    case 'type':
      return isTypeStep(arg) ? { screen: arg, typeStep: arg } : { screen: 'main' };
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
export function parseTyped(step: TypeStep, text: string): SettingsPatch | null {
  switch (step) {
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
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const TEXT = {
  en: {
    title: '⚙️ <b>Settings</b>',
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
    language: 'Language',
    status: 'Status',
    active: 'active',
    paused: 'paused',
    bMode: 'Delivery mode',
    bTimes: 'Send times',
    bQuiet: 'Quiet hours',
    bTz: 'Timezone',
    bScore: 'Minimum fit',
    bCap: 'Per send',
    bFormat: 'Format',
    bEmployment: 'Employment',
    bSalary: 'Salary',
    bSources: 'Sources',
    bLanguage: 'Русский',
    bPause: 'Pause',
    bResume: 'Resume',
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
    },
    badInput: 'Did not understand that. Try again, or /settings to go back.',
    saved: 'Saved.',
    formats: { remote: 'Remote', hybrid: 'Hybrid', onsite: 'Office' },
    employments: { full_time: 'Full-time', part_time: 'Part-time', freelance: 'Freelance' },
  },
  ru: {
    title: '⚙️ <b>Настройки</b>',
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
    language: 'Язык',
    status: 'Статус',
    active: 'активно',
    paused: 'на паузе',
    bMode: 'Режим доставки',
    bTimes: 'Время отправки',
    bQuiet: 'Тихие часы',
    bTz: 'Часовой пояс',
    bScore: 'Мин. совпадение',
    bCap: 'За раз',
    bFormat: 'Формат',
    bEmployment: 'Занятость',
    bSalary: 'Зарплата',
    bSources: 'Источники',
    bLanguage: 'English',
    bPause: 'Пауза',
    bResume: 'Возобновить',
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
    },
    badInput: 'Не понял. Попробуй ещё раз или набери /settings, чтобы вернуться.',
    saved: 'Сохранено.',
    formats: { remote: 'Удалённо', hybrid: 'Гибрид', onsite: 'Офис' },
    employments: { full_time: 'Полная', part_time: 'Частичная', freelance: 'Фриланс' },
  },
} as const;

export function settingsText(lang: Language, key: 'badInput' | 'saved'): string {
  return TEXT[lang][key];
}

const ns = BOT_CALLBACK_NAMESPACES.settings;
const button = (text: string, data: string) => ({ text, callbackData: `${ns}:${data}` });
const back = (lang: Language) => [button(TEXT[lang].back, 'menu')];
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
  const floor = state.mode === 'instant' ? state.instantMinScore : state.minScore;
  const formats = state.workFormats.map((f) => t.formats[f]).join(', ') || t.any;
  const employment = state.employmentTypes.map((e) => t.employments[e]).join(', ') || t.any;
  const lines = [
    t.title,
    '',
    `${t.status}: ${state.enabled ? t.active : t.paused}`,
    `${t.delivery}: ${deliveryLine(state, lang)}`,
    `${t.timezone}: ${escapeHtml(state.timezone)}`,
    `${t.minScore}: ${floor}%`,
    `${t.cap}: ${state.maxItems ?? t.capNone}`,
    `${t.format}: ${formats}`,
    `${t.employment}: ${employment}`,
    `${t.salary}: ${state.minSalaryUsd ? `$${state.minSalaryUsd}${t.perMonth}` : t.none}`,
    `${t.sourcesOff}: ${escapeHtml(state.mutedSources.join(', ')) || t.none}`,
    `${t.language}: ${lang === 'ru' ? 'Русский' : 'English'}`,
  ];
  return lines.join('\n');
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
    return { text: t.ask[typeStep], keyboard: [back(lang)] };
  }

  switch (screen) {
    case 'fmt':
      return {
        text: t.fmtHint,
        keyboard: [
          WORK_FORMATS.map((f) => button(`${mark(state.workFormats.includes(f))}${t.formats[f]}`, `fmt:${f}`)),
          back(lang),
        ],
      };
    case 'emp':
      return {
        text: t.empHint,
        keyboard: [
          EMPLOYMENT_TYPES.map((e) =>
            button(`${mark(state.employmentTypes.includes(e))}${t.employments[e]}`, `emp:${e}`),
          ),
          back(lang),
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
            3,
          ),
          back(lang),
        ],
      };
    case 'ms': {
      const current = state.mode === 'instant' ? state.instantMinScore : state.minScore;
      return {
        text: t.msHint(state.mode),
        keyboard: [
          ...rows(SCORE_PRESETS.map((n) => button(`${mark(n === current)}${n}%`, `ms:${n}`)), 3),
          back(lang),
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
          back(lang),
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
          back(lang),
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
          back(lang),
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
          back(lang),
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
          back(lang),
        ],
      };
    case 'main':
    default:
      return {
        text: summary(state, lang),
        keyboard: [
          [button(t.bMode, 'mode'), button(t.bTimes, 'open:t'), button(t.bQuiet, 'open:q')],
          [button(t.bTz, 'open:tz'), button(t.bScore, 'open:ms'), button(t.bCap, 'open:cap')],
          [button(t.bFormat, 'open:fmt'), button(t.bEmployment, 'open:emp'), button(t.bSalary, 'open:sal')],
          [
            button(t.bSources, 'open:src'),
            button(t.bLanguage, 'lang'),
            button(state.enabled ? t.bPause : t.bResume, 'pause'),
          ],
        ],
      };
  }
}
