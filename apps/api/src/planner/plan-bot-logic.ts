import {
  type ActiveFocusSession,
  BOT_CALLBACK_NAMESPACES,
  type DayPlanDetail,
  type DayPlanReview,
  elapsedMinutes,
  type Language,
  type PlanBlockCategory,
  type PlanBlockItem,
  plannedMinutes,
} from '@jobradar/shared';

import { escapeHtml, type InlineButton, type InlineKeyboard } from '../bot/telegram-api';

/**
 * `/plan` in the bot (roadmap 5.5, owner only per ADR-024 §3), kept pure: how
 * today's plan, a block card, the close confirmation and the day's result look,
 * what a button press asks for, and how a typed block is read. The service
 * (`plan-bot.service.ts`) only loads, calls `PlannerService` and sends.
 *
 * Callback data is `l:<action>[:<block uuid>]` — at most 2 + 2 + 37 = 41 bytes,
 * well inside Telegram's 64:
 *   l:v            re-render today's plan in place
 *   l:m            send today's plan as a new message (from a nudge)
 *   l:g / l:r      compose the plan with the LLM / regenerate the draft
 *   l:a            accept the draft
 *   l:n            add a block (opens a typed dialog)
 *   l:c / l:z      ask to close the day / close it
 *   l:o:<id>       open a block's card
 *   l:s:<id>       start (or resume) it;  l:p:<id>  pause it
 *   l:d:<id>       mark it done;          l:x:<id>  delete (drop) it
 */

export const NS = BOT_CALLBACK_NAMESPACES.plan;

/** The `bot_dialogs.flow` of the typed "add a block" answer. */
export const PLAN_DIALOG_FLOW = 'plan';

/** Telegram's message cap. */
export const MESSAGE_LIMIT = 4096;

const TEXT = {
  en: {
    ownerOnly: '📋 The day planner is available only to the author of JobRadar.',
    title: '📋 Plan for {date}',
    empty:
      'Nothing is planned for today yet. Compose a plan from your applications, interview prep and debt, or add a block by hand.',
    draft: '📝 Draft: accept it to take the day on.',
    accepted: '💪 The day is taken on.',
    fallback: 'The AI was unavailable, so the blocks are in the fixed order.',
    noCandidates: 'Nothing to compose from yet: add blocks by hand.',
    summary: '⏱ Planned {planned} of {capacity} min · ✅ {done} of {total} done',
    pick: 'Tap a block to start, pause or finish it.',
    thinking: '🤔 Composing the plan…',
    composeFailed: '⚠️ Could not compose the plan. Try again, or add blocks by hand.',
    composed: 'Draft ready',
    accepted_alert: 'Accepted',
    started: 'Started',
    paused: 'Paused',
    done: 'Done',
    dropped: 'Deleted',
    added: '➕ Added: {title}',
    failed: 'Could not do that: the plan has changed. Here is the current one.',
    gone: 'This block is not in today’s plan any more.',
    addPrompt:
      '➕ Type the block: a title and, after a comma, the minutes.\nFor example: <i>Prepare for the interview, 45</i>\nWithout minutes it gets {minutes} min.',
    badInput:
      'Could not read that. Send a title and minutes, for example: Prepare for the interview, 45 (minutes from 5 to 480).',
    closeAsk:
      '🌙 Close the day? Blocks left unfinished are recorded as skipped and go into tomorrow’s debt.',
    closedTitle: '🌙 Day closed',
    closedAuto: '🌙 Day closed automatically, without a review',
    reviewBlocks: '✅ {done} of {total} blocks done',
    reviewTime: '⏱ Planned {planned} min, actual {actual} min',
    reviewDebt: '📌 Going into debt: {count}',
    reviewNote: '📝 {note}',
    byCategory: 'Time by category:',
    category: 'Category',
    status: 'Status',
    estimate: 'Estimate',
    spent: 'Spent',
    min: '{minutes} min',
    ofMin: '{actual} / {estimate} min',
    'state.planned': '⏳ Planned',
    'state.running': '▶️ Running',
    'state.paused': '⏸ Paused',
    'state.done': '✅ Done',
    'state.partial': '🌓 Partly done',
    'state.skipped': '⏭ Skipped',
    'state.dropped': '🗑 Deleted',
    'cat.job_search': 'Job search',
    'cat.interview_prep': 'Interview prep',
    'cat.learning': 'Learning',
    'cat.admin': 'Admin',
    'cat.other': 'Other',
    'btn.compose': '✨ Compose a plan',
    'btn.add': '➕ Add a block',
    'btn.accept': '✅ Accept',
    'btn.regenerate': '🔄 Regenerate',
    'btn.refresh': '🔄 Refresh',
    'btn.close': '🌙 Close the day',
    'btn.closeYes': '🌙 Yes, close it',
    'btn.start': '▶️ Start',
    'btn.resume': '▶️ Resume',
    'btn.pause': '⏸ Pause',
    'btn.done': '✅ Done',
    'btn.delete': '🗑 Delete',
    'btn.back': '⬅️ Back',
    'btn.retry': '🔄 Try again',
    'btn.block': '{icon} {n}. {title}',
  },
  ru: {
    ownerOnly: '📋 Планировщик дня доступен только автору JobRadar.',
    title: '📋 План на {date}',
    empty:
      'На сегодня ещё ничего не запланировано. Составь план из откликов, подготовки к собеседованиям и долгов или добавь блок вручную.',
    draft: '📝 Черновик: прими его, чтобы взять день на себя.',
    accepted: '💪 День принят.',
    fallback: 'AI был недоступен, поэтому блоки стоят в фиксированном порядке.',
    noCandidates: 'Пока не из чего составлять: добавь блоки вручную.',
    summary: '⏱ Запланировано {planned} из {capacity} мин · ✅ готово {done} из {total}',
    pick: 'Нажми на блок, чтобы начать, поставить на паузу или завершить его.',
    thinking: '🤔 Составляю план…',
    composeFailed: '⚠️ Не получилось составить план. Попробуй ещё раз или добавь блоки вручную.',
    composed: 'Черновик готов',
    accepted_alert: 'Принято',
    started: 'Запущено',
    paused: 'На паузе',
    done: 'Готово',
    dropped: 'Удалено',
    added: '➕ Добавлено: {title}',
    failed: 'Не получилось: план изменился. Вот актуальный.',
    gone: 'Этого блока больше нет в сегодняшнем плане.',
    addPrompt:
      '➕ Напиши блок: название и через запятую минуты.\nНапример: <i>Подготовиться к собеседованию, 45</i>\nБез минут будет {minutes} мин.',
    badInput:
      'Не понял. Пришли название и минуты, например: Подготовиться к собеседованию, 45 (от 5 до 480 минут).',
    closeAsk:
      '🌙 Закрыть день? Незавершённые блоки запишутся как пропущенные и уйдут в долг на завтра.',
    closedTitle: '🌙 День закрыт',
    closedAuto: '🌙 День закрыт автоматически, без разбора',
    reviewBlocks: '✅ Готово {done} из {total} блоков',
    reviewTime: '⏱ Запланировано {planned} мин, на деле {actual} мин',
    reviewDebt: '📌 В долг уходит: {count}',
    reviewNote: '📝 {note}',
    byCategory: 'Время по категориям:',
    category: 'Категория',
    status: 'Статус',
    estimate: 'Оценка',
    spent: 'Потрачено',
    min: '{minutes} мин',
    ofMin: '{actual} / {estimate} мин',
    'state.planned': '⏳ Запланирован',
    'state.running': '▶️ Идёт',
    'state.paused': '⏸ На паузе',
    'state.done': '✅ Готово',
    'state.partial': '🌓 Сделан частично',
    'state.skipped': '⏭ Пропущен',
    'state.dropped': '🗑 Удалён',
    'cat.job_search': 'Поиск работы',
    'cat.interview_prep': 'Подготовка к собесу',
    'cat.learning': 'Обучение',
    'cat.admin': 'Организационное',
    'cat.other': 'Другое',
    'btn.compose': '✨ Составить план',
    'btn.add': '➕ Добавить блок',
    'btn.accept': '✅ Принять',
    'btn.regenerate': '🔄 Переделать',
    'btn.refresh': '🔄 Обновить',
    'btn.close': '🌙 Закрыть день',
    'btn.closeYes': '🌙 Да, закрыть',
    'btn.start': '▶️ Начать',
    'btn.resume': '▶️ Продолжить',
    'btn.pause': '⏸ Пауза',
    'btn.done': '✅ Готово',
    'btn.delete': '🗑 Удалить',
    'btn.back': '⬅️ Назад',
    'btn.retry': '🔄 Попробовать ещё',
    'btn.block': '{icon} {n}. {title}',
  },
} as const;

export type PlanTextKey = keyof (typeof TEXT)['en'];

export function planText(
  lang: Language,
  key: PlanTextKey,
  vars: Record<string, string | number> = {},
): string {
  const template: string = TEXT[lang]?.[key] ?? TEXT.en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export type BlockActionKind = 'open' | 'start' | 'pause' | 'done' | 'drop';

export type PlanAction =
  | { kind: 'view' }
  | { kind: 'send' }
  | { kind: 'compose'; regenerate: boolean }
  | { kind: 'accept' }
  | { kind: 'add' }
  | { kind: 'askClose' }
  | { kind: 'close' }
  | { kind: BlockActionKind; id: string };

const BLOCK_ACTIONS: Record<string, BlockActionKind> = {
  o: 'open',
  s: 'start',
  p: 'pause',
  d: 'done',
  x: 'drop',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a press asks for; null for malformed or foreign data. */
export function parseCallback(parts: string[]): PlanAction | null {
  const [ns, action, id] = parts;
  if (ns !== NS || !action) return null;
  switch (action) {
    case 'v':
      return { kind: 'view' };
    case 'm':
      return { kind: 'send' };
    case 'g':
      return { kind: 'compose', regenerate: false };
    case 'r':
      return { kind: 'compose', regenerate: true };
    case 'a':
      return { kind: 'accept' };
    case 'n':
      return { kind: 'add' };
    case 'c':
      return { kind: 'askClose' };
    case 'z':
      return { kind: 'close' };
  }
  const kind = BLOCK_ACTIONS[action];
  if (!kind || !id || !UUID.test(id)) return null;
  return { kind, id };
}

export const callbackData = {
  view: () => `${NS}:v`,
  send: () => `${NS}:m`,
  compose: () => `${NS}:g`,
  regenerate: () => `${NS}:r`,
  accept: () => `${NS}:a`,
  add: () => `${NS}:n`,
  askClose: () => `${NS}:c`,
  close: () => `${NS}:z`,
  block: (action: BlockActionKind, id: string) => {
    const code = Object.keys(BLOCK_ACTIONS).find((key) => BLOCK_ACTIONS[key] === action);
    return `${NS}:${code}:${id}`;
  },
};

// ---------------------------------------------------------------------------
// Typed block
// ---------------------------------------------------------------------------

export interface TypedBlock {
  title: string;
  /** Null when the user gave no minutes: the planner's default applies. */
  minutes: number | null;
}

const MINUTES_BOUNDS = { min: 5, max: 480 } as const;
const TITLE_MAX = 200;

/**
 * Reads "title, minutes" (also "title 45", "title — 45 min", "title 45м").
 * Minutes are optional; a number outside 5–480 is a mistake, not a title.
 */
export function parseBlockInput(text: string): TypedBlock | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(.*?)[\s,;:—–-]+(\d{1,4})\s*(?:m|min|mins|minutes|м|мин|минут|минуты|минута)?\.?$/i,
  );
  const title = (match ? match[1]! : trimmed).replace(/[\s,;:—–-]+$/, '').trim();
  // A bare number is minutes without a title, not a block called "45".
  if (!title || title.length > TITLE_MAX || /^\d+$/.test(title)) return null;
  if (!match) return { title, minutes: null };
  const minutes = Number(match[2]);
  if (minutes < MINUTES_BOUNDS.min || minutes > MINUTES_BOUNDS.max) return null;
  return { title, minutes };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface Screen {
  text: string;
  keyboard: InlineKeyboard;
}

export interface PlanView {
  lang: Language;
  now: Date;
  /** `YYYY-MM-DD` in the user's timezone. */
  today: string;
  plan: DayPlanDetail | null;
  capacityMinutes: number;
}

export type BlockState =
  | 'planned'
  | 'running'
  | 'paused'
  | 'done'
  | 'partial'
  | 'skipped'
  | 'dropped';

const STATE_ICON: Record<BlockState, string> = {
  planned: '⏳',
  running: '▶️',
  paused: '⏸',
  done: '✅',
  partial: '🌓',
  skipped: '⏭',
  dropped: '🗑',
};

/**
 * The planner has no "paused" status: a paused block is `pending` again with
 * time already banked on it (`PlannerService.pauseBlock`).
 */
export function blockState(block: PlanBlockItem): BlockState {
  switch (block.status) {
    case 'active':
      return 'running';
    case 'pending':
      return block.actualMinutes > 0 || block.startedAt ? 'paused' : 'planned';
    default:
      return block.status;
  }
}

function isOpenState(state: BlockState): boolean {
  return state === 'planned' || state === 'running' || state === 'paused';
}

/** Blocks the plan shows, in queue order; dropped ones are gone from the day. */
export function visibleBlocks(plan: DayPlanDetail | null): PlanBlockItem[] {
  if (!plan) return [];
  return plan.blocks
    .filter((block) => block.status !== 'dropped')
    .sort((a, b) => a.position - b.position);
}

/** Minutes on the block so far, the running session included. */
function spentMinutes(block: PlanBlockItem, session: ActiveFocusSession | null, now: Date): number {
  return session?.blockId === block.id ? elapsedMinutes(session, now) : block.actualMinutes;
}

function timing(
  lang: Language,
  block: PlanBlockItem,
  session: ActiveFocusSession | null,
  now: Date,
): string {
  const estimate = block.correctedEstimateMinutes;
  const state = blockState(block);
  const spent = spentMinutes(block, session, now);
  if (state === 'running' || state === 'paused') {
    return planText(lang, 'ofMin', { actual: spent, estimate });
  }
  if ((state === 'done' || state === 'partial') && spent > 0) {
    return planText(lang, 'min', { minutes: spent });
  }
  return planText(lang, 'min', { minutes: estimate });
}

/** Buttons two to a row: the developer's limit for the bot. */
export function pairs(buttons: InlineButton[]): InlineKeyboard {
  const rows: InlineKeyboard = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

function button(lang: Language, key: PlanTextKey, data: string): InlineButton {
  return { text: planText(lang, key), callbackData: data };
}

function formatDay(day: string, lang: Language): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trim()}…`;
}

/** Last resort against Telegram's cap; the screens are sized to stay well under it. */
export function fit(text: string): string {
  return text.length <= MESSAGE_LIMIT ? text : `${text.slice(0, MESSAGE_LIMIT - 1)}…`;
}

/** The day's result, as the web review shows it. Already HTML-escaped. */
export function renderReview(lang: Language, review: DayPlanReview): string {
  const lines = [
    planText(lang, 'reviewBlocks', { done: review.completedBlocks, total: review.totalBlocks }),
    planText(lang, 'reviewTime', {
      planned: review.plannedMinutes,
      actual: review.actualMinutes,
    }),
    planText(lang, 'reviewDebt', { count: review.debtCreated }),
  ];
  const categories = Object.entries(review.minutesByCategory).filter(
    ([, minutes]) => (minutes ?? 0) > 0,
  ) as [PlanBlockCategory, number][];
  if (categories.length > 0) {
    lines.push('', planText(lang, 'byCategory'));
    for (const [category, minutes] of categories) {
      lines.push(`• ${planText(lang, `cat.${category}`)}: ${planText(lang, 'min', { minutes })}`);
    }
  }
  if (review.note) lines.push('', planText(lang, 'reviewNote', { note: cut(review.note, 500) }));
  return escapeHtml(lines.join('\n'));
}

/**
 * Today's plan. `notice` is a line shown above the plan, e.g. what was just
 * added or that the AI fell back to the fixed order.
 */
export function renderPlan(view: PlanView, notice?: string): Screen {
  const { lang, plan, now } = view;
  const blocks = visibleBlocks(plan);
  const session = plan?.activeSession ?? null;
  const parts = [
    `<b>${escapeHtml(planText(lang, 'title', { date: formatDay(plan?.planDate ?? view.today, lang) }))}</b>`,
  ];
  if (notice) parts.push('', escapeHtml(notice));

  if (plan?.status === 'closed') {
    const review = plan.review;
    parts.push(
      '',
      `<b>${escapeHtml(planText(lang, plan.autoClosed ? 'closedAuto' : 'closedTitle'))}</b>`,
    );
    if (review) parts.push(renderReview(lang, review));
    if (blocks.length > 0) parts.push('', blockLines(lang, blocks, session, now));
    return { text: fit(parts.join('\n')), keyboard: [] };
  }

  if (blocks.length === 0) {
    parts.push('', escapeHtml(planText(lang, 'empty')));
    return {
      text: fit(parts.join('\n')),
      keyboard: pairs([
        button(lang, 'btn.compose', callbackData.compose()),
        button(lang, 'btn.add', callbackData.add()),
      ]),
    };
  }

  const draft = plan?.status !== 'accepted';
  parts.push('', escapeHtml(planText(lang, draft ? 'draft' : 'accepted')));
  parts.push('', blockLines(lang, blocks, session, now));
  parts.push(
    '',
    escapeHtml(
      planText(lang, 'summary', {
        planned: plannedMinutes(blocks),
        capacity: view.capacityMinutes,
        done: blocks.filter((block) => block.status === 'done').length,
        total: blocks.length,
      }),
    ),
    `<i>${escapeHtml(planText(lang, 'pick'))}</i>`,
  );

  const keyboard: InlineKeyboard = blocks.map((block, index) => [
    {
      text: planText(lang, 'btn.block', {
        icon: STATE_ICON[blockState(block)],
        n: index + 1,
        title: cut(block.title, 32),
      }),
      callbackData: callbackData.block('open', block.id),
    },
  ]);
  if (draft) {
    keyboard.push(
      ...pairs([
        button(lang, 'btn.accept', callbackData.accept()),
        button(lang, 'btn.regenerate', callbackData.regenerate()),
        button(lang, 'btn.add', callbackData.add()),
        button(lang, 'btn.close', callbackData.askClose()),
      ]),
    );
  } else {
    keyboard.push(
      ...pairs([
        button(lang, 'btn.add', callbackData.add()),
        button(lang, 'btn.refresh', callbackData.view()),
        button(lang, 'btn.close', callbackData.askClose()),
      ]),
    );
  }
  return { text: fit(parts.join('\n')), keyboard };
}

function blockLines(
  lang: Language,
  blocks: PlanBlockItem[],
  session: ActiveFocusSession | null,
  now: Date,
): string {
  return blocks
    .map(
      (block, index) =>
        `${STATE_ICON[blockState(block)]} ${index + 1}. <b>${escapeHtml(cut(block.title, 90))}</b>` +
        ` — ${escapeHtml(timing(lang, block, session, now))}`,
    )
    .join('\n');
}

/** The buttons a block offers in its state; a closed day offers none but Back. */
export function blockActions(state: BlockState, dayClosed: boolean): BlockActionKind[] {
  if (dayClosed || !isOpenState(state)) return [];
  switch (state) {
    case 'running':
      // Pause first: dropping a block with the clock running would orphan the session.
      return ['pause', 'done'];
    case 'paused':
    case 'planned':
    default:
      return ['start', 'done', 'drop'];
  }
}

/** One block: what it is, how it is going, and what can be done with it. */
export function renderBlock(view: PlanView, block: PlanBlockItem): Screen {
  const { lang, plan, now } = view;
  const state = blockState(block);
  const session = plan?.activeSession ?? null;
  const index = visibleBlocks(plan).findIndex((item) => item.id === block.id);
  const lines = [
    `<b>${STATE_ICON[state]} ${index >= 0 ? `${index + 1}. ` : ''}${escapeHtml(block.title)}</b>`,
  ];
  if (block.details) lines.push(`<i>${escapeHtml(cut(block.details, 1000))}</i>`);
  lines.push(
    '',
    `${escapeHtml(planText(lang, 'status'))}: ${escapeHtml(planText(lang, `state.${state}`))}`,
    `${escapeHtml(planText(lang, 'category'))}: ${escapeHtml(planText(lang, `cat.${block.category}`))}`,
    `${escapeHtml(planText(lang, 'estimate'))}: ${escapeHtml(
      planText(lang, 'min', { minutes: block.correctedEstimateMinutes }),
    )}`,
  );
  const spent = spentMinutes(block, session, now);
  if (spent > 0) {
    lines.push(
      `${escapeHtml(planText(lang, 'spent'))}: ${escapeHtml(planText(lang, 'min', { minutes: spent }))}`,
    );
  }

  const labels: Record<BlockActionKind, PlanTextKey> = {
    open: 'btn.back',
    start: state === 'paused' ? 'btn.resume' : 'btn.start',
    pause: 'btn.pause',
    done: 'btn.done',
    drop: 'btn.delete',
  };
  const buttons = blockActions(state, plan?.status === 'closed').map((action) =>
    button(lang, labels[action], callbackData.block(action, block.id)),
  );
  buttons.push(button(lang, 'btn.back', callbackData.view()));
  return { text: fit(lines.join('\n')), keyboard: pairs(buttons) };
}

export function renderCloseConfirm(lang: Language): Screen {
  return {
    text: escapeHtml(planText(lang, 'closeAsk')),
    keyboard: pairs([
      button(lang, 'btn.closeYes', callbackData.close()),
      button(lang, 'btn.back', callbackData.view()),
    ]),
  };
}

export function renderThinking(lang: Language): string {
  return escapeHtml(planText(lang, 'thinking'));
}

export function renderComposeFailed(lang: Language): Screen {
  return {
    text: escapeHtml(planText(lang, 'composeFailed')),
    keyboard: pairs([
      button(lang, 'btn.retry', callbackData.compose()),
      button(lang, 'btn.add', callbackData.add()),
      button(lang, 'btn.back', callbackData.view()),
    ]),
  };
}

export function renderAddPrompt(lang: Language, defaultMinutes: number): Screen {
  // The template carries its own <i> markup; the only variable is a number.
  return {
    text: planText(lang, 'addPrompt', { minutes: defaultMinutes }),
    keyboard: [[button(lang, 'btn.back', callbackData.view())]],
  };
}

/** A notice for a freshly composed draft: why it is in fixed order, or why it is empty. */
export function composeNotice(lang: Language, plan: DayPlanDetail): string | undefined {
  if (visibleBlocks(plan).length === 0) return planText(lang, 'noCandidates');
  if (plan.generatedBy === 'fallback') return planText(lang, 'fallback');
  return undefined;
}
