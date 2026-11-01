import { BOT_CALLBACK_NAMESPACES, type Language } from '@jobradar/shared';

import { escapeHtml, type InlineKeyboard, TelegramApiError } from '../bot/telegram-api';

/**
 * The bug and feedback inbox (ADR-037), pure half: what counts as a transient
 * fault, how errors are grouped, how the owner's triage list and the GitHub
 * issue read. The bot (`TriageBotService`) and the daily workflow
 * (`scripts/triage.ts`) render the list with the same function, so a press on
 * the workflow's message redraws it the way the bot would.
 */

export type ReportKind = 'error' | 'feedback';
/** new → fix (owner pressed 🛠) → issued (GitHub issue open) → done; or skip. */
export type ReportStatus = 'new' | 'fix' | 'skip' | 'issued' | 'done';

/** The label the fixer looks for on GitHub issues. */
export const FIX_LABEL = 'agent-fix';
/** Items one triage message lists; the rest wait for the next one. */
export const TRIAGE_LIMIT = 10;
/** A transient fault is listed only once it repeats this often; until then it is a count. */
export const TRANSIENT_FLOOR = 5;
/** Longest error message or feedback text quoted in the triage message. */
const QUOTE_MAX = 220;

export interface TriageItem {
  id: number;
  kind: ReportKind;
  title: string;
  detail: string;
  count: number;
  transient: boolean;
  status: ReportStatus;
  /** Not in any daily digest yet; the digest goes out only when one is. */
  unseen: boolean;
}

export interface TriageExtras {
  /** Transient faults seen in the last day that are below `TRANSIENT_FLOOR`. */
  quietTransient: number;
  /** Items already turned into GitHub issues and waiting for the fixer. */
  inProgress: number;
}

// Node's fetch says "fetch failed" and keeps the reason in `cause`; the pg
// driver and AbortSignal have their own wording. None of these is a bug in
// the code: the same call succeeds a moment later.
const TRANSIENT_PATTERN =
  /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|other side closed|UND_ERR|aborted due to timeout|operation was aborted|Connection terminated|timeout exceeded when trying to connect|Too Many Requests|Bad Gateway|Gateway Timeout|Service Unavailable/i;

/** A network fault, a timeout, or Telegram asking us to wait (429) or failing itself (5xx). */
export function isTransientError(err: unknown): boolean {
  if (err instanceof TelegramApiError && err.errorCode !== undefined) {
    if (err.errorCode === 429 || err.errorCode >= 500) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERN.test(message);
}

/** Ids and numbers vary between occurrences of the same fault; they must not split it. */
export function normaliseMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One inbox row per distinct fault: where it happened and what it said. */
export function errorFingerprint(where: string, message: string): string {
  return `error:${where}|${normaliseMessage(message)}`.slice(0, 300);
}

/**
 * Feedback goes to a public issue tracker only after the owner presses 🛠,
 * and then without the author and without contacts the text happens to hold.
 */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/(https?:\/\/)?t\.me\/\S+/gi, '[telegram]')
    .replace(/@\w{4,}/g, '[user]')
    .replace(/\+?\d[\d\s()-]{7,}\d/g, '[phone]');
}

/** The first words of a feedback text, for the issue title. */
export function feedbackTitle(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

const TEXT = {
  en: {
    header: '🧰 Bugs and feedback: {n} open',
    empty: '🧰 No open bugs or feedback.',
    fix: 'to be fixed',
    more: '…and {n} more: they show here once these are marked.',
    quiet:
      '⚡ Temporary network faults in 24 h: {n}. Not bugs: they are listed only past {floor} repeats.',
    progress: '🔧 With the fixer: {n} (GitHub issues labelled agent-fix).',
    how: '🛠 makes a GitHub issue the fixer takes (synced every morning and evening, and before each fixer run), 🙈 skips, ↩️ undoes.',
    marked: '#{id}: to be fixed',
    skipped: '#{id}: skipped',
    reopened: '#{id}: back in the list',
    gone: '#{id} is already with the fixer or closed.',
    ownerOnly: 'Available to the author only.',
  },
  ru: {
    header: '🧰 Баги и отзывы: открыто {n}',
    empty: '🧰 Открытых багов и отзывов нет.',
    fix: 'в работу',
    more: '…и ещё {n}: появятся здесь, когда эти будут отмечены.',
    quiet:
      '⚡ Временных сетевых сбоев за сутки: {n}. Это не баги: в список попадают только после {floor} повторов.',
    progress: '🔧 У фиксера: {n} (GitHub issues с меткой agent-fix).',
    how: '🛠 создаёт GitHub issue для фиксера (синхронизация утром, вечером и перед каждым запуском фиксера), 🙈 пропускает, ↩️ отменяет.',
    marked: '#{id}: в работу',
    skipped: '#{id}: пропущено',
    reopened: '#{id}: снова в списке',
    gone: '#{id} уже у фиксера или закрыт.',
    ownerOnly: 'Доступно только автору.',
  },
} as const;

export type TriageTextKey = keyof (typeof TEXT)['en'];

export function triageText(lang: Language, key: TriageTextKey, values: Record<string, string | number> = {}): string {
  let text: string = TEXT[lang][key];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return escapeHtml(flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX - 1)}…` : flat);
}

/** The owner's triage list: the message text (HTML) and one button row per item. */
export function renderTriage(
  lang: Language,
  items: TriageItem[],
  extras: TriageExtras,
): { text: string; keyboard: InlineKeyboard } {
  const ns = BOT_CALLBACK_NAMESPACES.triage;
  const shown = items.slice(0, TRIAGE_LIMIT);
  const lines: string[] = [
    items.length > 0 ? triageText(lang, 'header', { n: items.length }) : triageText(lang, 'empty'),
  ];
  const keyboard: InlineKeyboard = [];

  for (const item of shown) {
    const mark = item.status === 'fix' ? `🛠 <i>${triageText(lang, 'fix')}</i> ` : '';
    const times = item.count > 1 ? ` ×${item.count}` : '';
    if (item.kind === 'error') {
      const icon = item.transient ? '⚡' : '⚠️';
      lines.push('', `<b>#${item.id}</b> ${mark}${icon} <code>${escapeHtml(item.title)}</code>${times}`, quote(item.detail));
    } else {
      lines.push('', `<b>#${item.id}</b> ${mark}💬 ${quote(item.detail)}`);
    }
    keyboard.push(
      item.status === 'fix'
        ? [
            { text: `↩️ #${item.id}`, callbackData: `${ns}:n:${item.id}` },
            { text: `🙈 #${item.id}`, callbackData: `${ns}:s:${item.id}` },
          ]
        : [
            { text: `🛠 #${item.id}`, callbackData: `${ns}:f:${item.id}` },
            { text: `🙈 #${item.id}`, callbackData: `${ns}:s:${item.id}` },
          ],
    );
  }

  const footer: string[] = [];
  if (items.length > shown.length) footer.push(triageText(lang, 'more', { n: items.length - shown.length }));
  if (extras.quietTransient > 0) {
    footer.push(triageText(lang, 'quiet', { n: extras.quietTransient, floor: TRANSIENT_FLOOR }));
  }
  if (extras.inProgress > 0) footer.push(triageText(lang, 'progress', { n: extras.inProgress }));
  if (shown.length > 0) footer.push(triageText(lang, 'how'));
  if (footer.length > 0) lines.push('', ...footer);

  return { text: lines.join('\n'), keyboard };
}

export interface IssueSource extends TriageItem {
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** Text that sits inside a fenced block must not close it. */
const fenced = (text: string) => text.replaceAll('```', "'''");

export function issueTitle(item: IssueSource): string {
  return item.kind === 'error'
    ? `Bot error: ${item.title} — ${normaliseMessage(item.detail).slice(0, 80)}`
    : `Feedback: ${feedbackTitle(redact(item.detail))}`;
}

/** The issue the fixer reads: what happened, how often, and what is expected of it. */
export function issueBody(item: IssueSource): string {
  const day = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
  const lines =
    item.kind === 'error'
      ? [
          `**Inbox report #${item.id}: bot error** (ADR-037)`,
          '',
          `- Where: \`${item.title}\``,
          `- Seen: ${item.count} time(s), first ${day(item.firstSeenAt)} UTC, last ${day(item.lastSeenAt)} UTC`,
          `- Transient (network, timeout, Telegram 429/5xx): ${item.transient ? 'yes' : 'no'}`,
          '',
          '```text',
          fenced(item.detail),
          '```',
        ]
      : [
          `**Inbox report #${item.id}: user feedback** (ADR-037, author and contacts removed)`,
          '',
          '```text',
          fenced(redact(item.detail)),
          '```',
        ];
  lines.push(
    '',
    'The owner marked this for the automatic fixer. Follow CLAUDE.md: find the cause, fix it with tests, ' +
      'and open a PR whose body says `Fixes #<this issue>`. If it is not a defect in the code (a network ' +
      'fault, a wish that changes the product, a misunderstanding), comment why and close the issue as not planned.',
  );
  return lines.join('\n');
}
