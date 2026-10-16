import {
  type ApplicationItem,
  type ApplicationStage,
  BOT_CALLBACK_NAMESPACES,
  daysSinceActivity,
  isReminderDue,
  type Language,
} from '@jobradar/shared';

import { escapeHtml, type InlineButton, type InlineKeyboard } from '../bot/telegram-api';

/**
 * `/applications` in the bot (roadmap 5.5), kept pure: how the list, a card,
 * the delete confirmation and a follow-up reminder look, and what a button
 * press asks for. The service only loads, writes and sends.
 *
 * Callback data is `j:<action>[:<application uuid>[:<stage code>]]` — at most
 * 2 + 2 + 37 + 2 = 43 bytes, well inside Telegram's 64:
 *   j:l / j:a        the active list / the archive
 *   j:o:<id>         open an application's card
 *   j:s:<id>:<code>  move it to a stage (codes in STAGE_CODES)
 *   j:d:<id>         ask to delete it;  j:x:<id>  delete it
 *   j:z:<id>         "remind me later" on a follow-up reminder
 */

const NS = BOT_CALLBACK_NAMESPACES.applications;

/** How many applications one screen lists. */
export const LIST_LIMIT = 10;

/** Stages the user can move an application to from the bot, in funnel order. */
export const STAGE_CODES = {
  applied: 'a',
  screening: 's',
  tech_interview: 'i',
  offer: 'o',
  rejected: 'r',
  withdrawn: 'w',
} as const satisfies Partial<Record<ApplicationStage, string>>;

export type MovableStage = keyof typeof STAGE_CODES;
const MOVABLE_STAGES = Object.keys(STAGE_CODES) as MovableStage[];

const ACTIVE_STAGES: ApplicationStage[] = [
  'saved',
  'applied',
  'screening',
  'tech_interview',
  'offer',
];
export const ARCHIVE_STAGES: ApplicationStage[] = ['rejected', 'withdrawn'];

export function isArchived(stage: ApplicationStage): boolean {
  return ARCHIVE_STAGES.includes(stage);
}

const TEXT = {
  en: {
    'stage.saved': '🔖 Saved',
    'stage.applied': '📨 Applied',
    'stage.screening': '📞 Screening',
    'stage.tech_interview': '💻 Interview',
    'stage.offer': '🎉 Offer',
    'stage.rejected': '❌ Rejected',
    'stage.withdrawn': '🚫 Withdrawn',
    title: '📋 Your applications',
    archiveTitle: '🗄 Archive: rejected and withdrawn',
    empty:
      'No applications yet.\n\nOnce you have applied for a vacancy, press “✅ Applied” under its card: it lands here, you move it through the stages, and the bot reminds you to follow up when a company goes quiet.',
    archiveEmpty: 'The archive is empty: nothing rejected or withdrawn.',
    more: 'The {shown} most recently updated of {total}.',
    pick: 'Tap an application to open it.',
    archive: '🗄 Archive ({count})',
    back: '⬅️ Back',
    open: '📄 {n}. {title}',
    company: 'Company',
    stage: 'Stage',
    appliedOn: 'Applied',
    lastChange: 'Last change',
    followUp: '⏰ time to follow up',
    posting: '🔗 Open the posting',
    moveTo: 'Move it to another stage:',
    delete: '🗑 Delete',
    deleteAsk:
      'Delete this application? It disappears from your list for good; the vacancy itself stays.',
    deleteYes: '🗑 Yes, delete',
    deleteNo: '⬅️ No, keep it',
    deleted: 'Deleted.',
    gone: 'This application is gone.',
    moved: 'Moved: {stage}',
    reminder: '⏰ No answer from {company} for {days}: {title}. Did anything change?',
    snooze: '⏳ Remind in {days}',
    snoozed: '⏳ Got it: I will remind you again in {days}.',
    today: 'today',
    ago: '{days} ago',
  },
  ru: {
    'stage.saved': '🔖 Сохранено',
    'stage.applied': '📨 Отклик',
    'stage.screening': '📞 Скрининг',
    'stage.tech_interview': '💻 Собеседование',
    'stage.offer': '🎉 Оффер',
    'stage.rejected': '❌ Отказ',
    'stage.withdrawn': '🚫 Отозван',
    title: '📋 Твои отклики',
    archiveTitle: '🗄 Архив: отказы и отозванные',
    empty:
      'Откликов пока нет.\n\nКогда откликнешься на вакансию, нажми «✅ Откликнулся» под её карточкой: она появится здесь, ты будешь отмечать этапы, а бот напомнит написать компании, если она замолчит.',
    archiveEmpty: 'Архив пуст: отказов и отозванных нет.',
    more: 'Показаны {shown} последних из {total}.',
    pick: 'Нажми на отклик, чтобы открыть его.',
    archive: '🗄 Архив ({count})',
    back: '⬅️ Назад',
    open: '📄 {n}. {title}',
    company: 'Компания',
    stage: 'Этап',
    appliedOn: 'Отклик',
    lastChange: 'Последнее изменение',
    followUp: '⏰ пора напомнить о себе',
    posting: '🔗 Открыть вакансию',
    moveTo: 'Перевести на другой этап:',
    delete: '🗑 Удалить',
    deleteAsk: 'Удалить этот отклик? Он навсегда пропадёт из списка; сама вакансия останется.',
    deleteYes: '🗑 Да, удалить',
    deleteNo: '⬅️ Нет, оставить',
    deleted: 'Удалено.',
    gone: 'Этого отклика больше нет.',
    moved: 'Этап: {stage}',
    reminder: '⏰ Нет ответа от {company} уже {days}: {title}. Что-нибудь изменилось?',
    snooze: '⏳ Напомнить через {days}',
    snoozed: '⏳ Хорошо: напомню ещё раз через {days}.',
    today: 'сегодня',
    ago: '{days} назад',
  },
} as const;

export type ApplicationsTextKey = keyof (typeof TEXT)['en'];

export function applicationsText(
  lang: Language,
  key: ApplicationsTextKey,
  vars: Record<string, string | number> = {},
): string {
  const template: string = TEXT[lang]?.[key] ?? TEXT.en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function stageLabel(lang: Language, stage: ApplicationStage): string {
  return applicationsText(lang, `stage.${stage}`);
}

/** "1 day" / "5 days"; Russian picks день / дня / дней. */
export function daysWord(lang: Language, days: number): string {
  if (lang === 'en') return days === 1 ? '1 day' : `${days} days`;
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'день'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'дня'
        : 'дней';
  return `${days} ${word}`;
}

function sinceLabel(lang: Language, days: number): string {
  return days === 0
    ? applicationsText(lang, 'today')
    : applicationsText(lang, 'ago', { days: daysWord(lang, days) });
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export type ApplicationsAction =
  | { kind: 'list'; archived: boolean }
  | { kind: 'open'; id: string }
  | { kind: 'stage'; id: string; stage: MovableStage }
  | { kind: 'askDelete'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'snooze'; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a press asks for; null for malformed or foreign data. */
export function parseCallback(parts: string[]): ApplicationsAction | null {
  const [ns, action, id, code] = parts;
  if (ns !== NS) return null;
  if (action === 'l' || action === 'a') return { kind: 'list', archived: action === 'a' };
  if (!id || !UUID.test(id)) return null;
  switch (action) {
    case 'o':
      return { kind: 'open', id };
    case 'd':
      return { kind: 'askDelete', id };
    case 'x':
      return { kind: 'delete', id };
    case 'z':
      return { kind: 'snooze', id };
    case 's': {
      const stage = MOVABLE_STAGES.find((s) => STAGE_CODES[s] === code);
      return stage ? { kind: 'stage', id, stage } : null;
    }
    default:
      return null;
  }
}

export const callbackData = {
  list: (archived = false) => `${NS}:${archived ? 'a' : 'l'}`,
  open: (id: string) => `${NS}:o:${id}`,
  stage: (id: string, stage: MovableStage) => `${NS}:s:${id}:${STAGE_CODES[stage]}`,
  askDelete: (id: string) => `${NS}:d:${id}`,
  delete: (id: string) => `${NS}:x:${id}`,
  snooze: (id: string) => `${NS}:z:${id}`,
};

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export interface Screen {
  text: string;
  keyboard: InlineKeyboard;
}

export interface RenderContext {
  lang: Language;
  now: Date;
  /** The user's IANA timezone, for dates. */
  timezone: string;
}

/** Buttons two to a row: the developer's limit for the bot. */
export function pairs(buttons: InlineButton[]): InlineKeyboard {
  const rows: InlineKeyboard = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

/**
 * The list screen. `counts` is the per-stage total of all the user's
 * applications (the stats query), `items` the most recent of the group.
 */
export function renderList(
  ctx: RenderContext,
  archived: boolean,
  items: ApplicationItem[],
  counts: Partial<Record<ApplicationStage, number>>,
): Screen {
  const { lang } = ctx;
  const stages = archived ? ARCHIVE_STAGES : ACTIVE_STAGES;
  const total = stages.reduce((sum, stage) => sum + (counts[stage] ?? 0), 0);
  const archiveCount = ARCHIVE_STAGES.reduce((sum, stage) => sum + (counts[stage] ?? 0), 0);

  const keyboard: InlineKeyboard = [];
  const footer: InlineButton[] = [];
  if (archived)
    footer.push({ text: applicationsText(lang, 'back'), callbackData: callbackData.list() });
  else if (archiveCount > 0) {
    footer.push({
      text: applicationsText(lang, 'archive', { count: archiveCount }),
      callbackData: callbackData.list(true),
    });
  }

  if (items.length === 0) {
    if (footer.length > 0) keyboard.push(footer);
    const title = archived ? '' : `<b>${escapeHtml(applicationsText(lang, 'title'))}</b>\n\n`;
    return {
      text: `${title}${escapeHtml(applicationsText(lang, archived ? 'archiveEmpty' : 'empty'))}`,
      keyboard,
    };
  }

  const summary = stages
    .filter((stage) => (counts[stage] ?? 0) > 0)
    .map((stage) => `${stageLabel(lang, stage)}: ${counts[stage]}`)
    .join(' · ');

  const lines = items.map((item, index) => {
    const days = daysSinceActivity(item, ctx.now);
    const due = isReminderDue(item, ctx.now) ? ' ⏰' : '';
    const company = item.vacancy.company ? ` — ${escapeHtml(cut(item.vacancy.company, 60))}` : '';
    return (
      `${index + 1}. <b>${escapeHtml(cut(item.vacancy.title, 100))}</b>${company}\n` +
      `    ${escapeHtml(`${stageLabel(lang, item.stage)} · ${sinceLabel(lang, days)}`)}${due}`
    );
  });

  const parts = [
    `<b>${escapeHtml(applicationsText(lang, archived ? 'archiveTitle' : 'title'))}</b>`,
    escapeHtml(summary),
    '',
    lines.join('\n'),
    '',
  ];
  if (total > items.length) {
    parts.push(escapeHtml(applicationsText(lang, 'more', { shown: items.length, total })));
  }
  parts.push(`<i>${escapeHtml(applicationsText(lang, 'pick'))}</i>`);

  keyboard.push(
    ...pairs(
      items.map((item, index) => ({
        text: applicationsText(lang, 'open', { n: index + 1, title: cut(item.vacancy.title, 26) }),
        callbackData: callbackData.open(item.id),
      })),
    ),
  );
  if (footer.length > 0) keyboard.push(footer);

  return { text: parts.join('\n'), keyboard };
}

/** Buttons moving an application to every bot stage except the one it is in. */
export function stageButtons(
  lang: Language,
  item: Pick<ApplicationItem, 'id' | 'stage'>,
): InlineButton[] {
  return MOVABLE_STAGES.filter((stage) => stage !== item.stage).map((stage) => ({
    text: stageLabel(lang, stage),
    callbackData: callbackData.stage(item.id, stage),
  }));
}

function cardBody(ctx: RenderContext, item: ApplicationItem): string {
  const { lang } = ctx;
  const days = daysSinceActivity(item, ctx.now);
  const lines = [`<b>${escapeHtml(cut(item.vacancy.title, 200))}</b>`];
  if (item.vacancy.company) {
    lines.push(
      `${escapeHtml(applicationsText(lang, 'company'))}: ${escapeHtml(cut(item.vacancy.company, 100))}`,
    );
  }
  lines.push(
    `${escapeHtml(applicationsText(lang, 'stage'))}: ${escapeHtml(stageLabel(lang, item.stage))}`,
  );
  if (item.appliedAt) {
    lines.push(
      `${escapeHtml(applicationsText(lang, 'appliedOn'))}: ${escapeHtml(
        formatDate(new Date(item.appliedAt), lang, ctx.timezone),
      )}`,
    );
  }
  const due = isReminderDue(item, ctx.now) ? ` · ${applicationsText(lang, 'followUp')}` : '';
  lines.push(
    `${escapeHtml(applicationsText(lang, 'lastChange'))}: ${escapeHtml(sinceLabel(lang, days) + due)}`,
  );
  if (item.vacancy.url) {
    lines.push(
      `<a href="${escapeHtml(item.vacancy.url)}">${escapeHtml(applicationsText(lang, 'posting'))}</a>`,
    );
  }
  return lines.join('\n');
}

/** One application, with its stage buttons, delete and back. */
export function renderCard(ctx: RenderContext, item: ApplicationItem): Screen {
  const { lang } = ctx;
  return {
    text: `${cardBody(ctx, item)}\n\n${escapeHtml(applicationsText(lang, 'moveTo'))}`,
    keyboard: [
      ...pairs(stageButtons(lang, item)),
      [
        { text: applicationsText(lang, 'delete'), callbackData: callbackData.askDelete(item.id) },
        {
          text: applicationsText(lang, 'back'),
          callbackData: callbackData.list(isArchived(item.stage)),
        },
      ],
    ],
  };
}

/** The confirmation step before a delete. */
export function renderDeleteConfirm(ctx: RenderContext, item: ApplicationItem): Screen {
  const { lang } = ctx;
  return {
    text: `${cardBody(ctx, item)}\n\n<b>${escapeHtml(applicationsText(lang, 'deleteAsk'))}</b>`,
    keyboard: [
      [
        { text: applicationsText(lang, 'deleteYes'), callbackData: callbackData.delete(item.id) },
        { text: applicationsText(lang, 'deleteNo'), callbackData: callbackData.open(item.id) },
      ],
    ],
  };
}

export interface ReminderView {
  id: string;
  stage: ApplicationStage;
  title: string;
  company: string;
  /** Whole days since the last activity. */
  days: number;
  /** Days the snooze button promises (the application's own threshold). */
  snoozeDays: number;
}

export function reminderText(lang: Language, view: ReminderView): string {
  return applicationsText(lang, 'reminder', {
    company: `<b>${escapeHtml(cut(view.company || '—', 100))}</b>`,
    days: escapeHtml(daysWord(lang, view.days)),
    title: escapeHtml(cut(view.title, 200)),
  });
}

/** The follow-up nudge: the card's stage buttons plus "remind me later". */
export function renderReminder(lang: Language, view: ReminderView): Screen {
  return {
    text: reminderText(lang, view),
    keyboard: pairs([
      ...stageButtons(lang, view),
      {
        text: applicationsText(lang, 'snooze', { days: daysWord(lang, view.snoozeDays) }),
        callbackData: callbackData.snooze(view.id),
      },
    ]),
  };
}

/** What a reminder turns into once "remind me later" was pressed. */
export function renderSnoozed(lang: Language, item: ApplicationItem, days: number): Screen {
  const company = item.vacancy.company ? ` — ${escapeHtml(cut(item.vacancy.company, 100))}` : '';
  return {
    text: `<b>${escapeHtml(cut(item.vacancy.title, 200))}</b>${company}\n\n${escapeHtml(
      applicationsText(lang, 'snoozed', { days: daysWord(lang, days) }),
    )}`,
    keyboard: [],
  };
}

function formatDate(date: Date, lang: Language, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  };
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
  }
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trim()}…`;
}
