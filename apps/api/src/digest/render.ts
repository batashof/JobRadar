import { BOT_CALLBACK_NAMESPACES, type Language } from '@jobradar/shared';

import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';
import type { ScoredCandidate } from './select';

/** Message text and keyboards for the digest, kept pure and testable. */

const NS = BOT_CALLBACK_NAMESPACES.digest;

/** Telegram refuses anything longer, so a long card is split across messages. */
const MESSAGE_LIMIT = 4096;

/**
 * Messages per vacancy. Real postings run ~4k characters and the long tail
 * reaches 17k, so one message would cut half of them mid-sentence; three cover
 * the overwhelming majority and still stop a single vacancy from flooding the
 * chat. What does not fit stays one tap away behind "Details".
 */
const MAX_PARTS = 3;

/** One letter per action — `callback_data` is capped at 64 bytes. */
export const DIGEST_ACTION = {
  hide: 'h',
  up: 'u',
  down: 'w',
} as const;

const TEXT = {
  en: {
    header: 'Digest: {count} vacancies for you',
    headerOne: 'Digest: one vacancy for you',
    empty: 'Nothing worth your attention today.',
    apply: 'Apply',
    details: 'Details',
    source: 'Original',
    hide: 'Hide',
    hidden: 'Hidden — it will not come back.',
    liked: 'Noted: more like this.',
    disliked: 'Noted: fewer like this.',
    fit: 'fit',
    published: 'published',
    contact: 'Contact',
    continued: 'continued',
    truncated: 'The posting goes on — the full text is behind "Details".',
    'format.remote': 'Remote',
    'format.onsite': 'On-site',
    'format.hybrid': 'Hybrid',
    'employment.full_time': 'Full-time',
    'employment.part_time': 'Part-time',
    'employment.freelance': 'Freelance',
  },
  ru: {
    header: 'Выжимка: {count} вакансий для тебя',
    headerOne: 'Выжимка: одна вакансия для тебя',
    empty: 'Сегодня ничего стоящего.',
    apply: 'Откликнуться',
    details: 'Подробнее',
    source: 'Первоисточник',
    hide: 'Скрыть',
    hidden: 'Скрыто — больше не появится.',
    liked: 'Принято: больше такого.',
    disliked: 'Принято: меньше такого.',
    fit: 'соответствие',
    published: 'опубликовано',
    contact: 'Контакт',
    continued: 'продолжение',
    truncated: 'Описание длиннее — полный текст по кнопке «Подробнее».',
    'format.remote': 'Удалённо',
    'format.onsite': 'В офисе',
    'format.hybrid': 'Гибрид',
    'employment.full_time': 'Полная занятость',
    'employment.part_time': 'Частичная занятость',
    'employment.freelance': 'Фриланс',
  },
} as const;

export type DigestTextKey = keyof (typeof TEXT)['en'];

export function digestText(lang: Language, key: DigestTextKey): string {
  return TEXT[lang]?.[key] ?? TEXT.en[key];
}

export function renderHeader(lang: Language, count: number): string {
  const template =
    count === 1 ? digestText(lang, 'headerOne') : digestText(lang, 'header');
  return `<b>${escapeHtml(template.replace('{count}', String(count)))}</b>`;
}

/**
 * One vacancy as the messages that carry it: the facts, then the posting text
 * itself. The card used to stop at the headline and push the reader to the
 * browser for everything else, which made the digest a list of links — the
 * whole point of the push is being able to judge a vacancy without leaving the
 * chat, so the description travels with it.
 *
 * Everything interpolated is source data — titles, companies and descriptions
 * come from scraped postings, so all of it is escaped.
 */
export function renderCardParts(
  item: ScoredCandidate,
  lang: Language,
  timezone = 'UTC',
): string[] {
  const head = renderHead(item, lang, timezone);
  const body = formatDescription(item.description);
  if (!body) return [head];

  const parts: string[] = [];
  let rest = body;

  for (let index = 0; index < MAX_PARTS && rest; index += 1) {
    const last = index === MAX_PARTS - 1;
    const prefix =
      index === 0
        ? `${head}\n\n`
        : `<i>${escapeHtml(`${cut(item.title, 150)} — ${digestText(lang, 'continued')}`)}</i>\n\n`;
    // Only the final part can end mid-posting, so only it reserves the notice.
    const tail = last ? `\n\n<i>${escapeHtml(digestText(lang, 'truncated'))}</i>` : '';

    const [chunk, remainder] = takeChunk(rest, MESSAGE_LIMIT - prefix.length - tail.length);
    // A budget too small for even one word: stop rather than loop forever.
    if (!chunk) break;

    rest = remainder;
    parts.push(`${prefix}${escapeHtml(chunk)}${rest ? tail : ''}`);
  }

  return parts.length > 0 ? parts : [head];
}

/**
 * Apply is a callback, not a link: the whole point is not having to leave the
 * chat. It is namespaced to `a:` (outreach), so this module renders the button
 * without knowing anything about how applying works. Details stays a link — it
 * is now the way to the rest of a description too long for the chat.
 *
 * "Original" is the posting where it was published. Everything else the digest
 * offers is JobRadar's rendering of a vacancy — sanitized, whitespace-collapsed
 * and possibly cut at three messages — and none of it is where you actually
 * apply on a board that wants its own form. That link was reachable only as a
 * fallback for a missing `WEB_ORIGIN`, which is to say never in production.
 * Both buttons are shown; they lead to genuinely different places.
 */
export function renderKeyboard(
  item: ScoredCandidate,
  lang: Language,
  webOrigin: string,
): InlineKeyboard {
  const appUrl = webOrigin ? `${webOrigin}/app/vacancies/${item.id}` : item.url;
  const top = [
    {
      text: digestText(lang, 'apply'),
      callbackData: `${BOT_CALLBACK_NAMESPACES.apply}:d:${item.id}`,
    },
    { text: digestText(lang, 'details'), url: appUrl },
  ];
  // Only when it adds something: with no WEB_ORIGIN, "Details" already is the
  // source, and two buttons to one URL is noise.
  if (item.url && item.url !== appUrl) {
    top.push({ text: digestText(lang, 'source'), url: item.url });
  }

  return [
    top,
    [
      { text: '👍', callbackData: `${NS}:${DIGEST_ACTION.up}:${item.id}` },
      { text: '👎', callbackData: `${NS}:${DIGEST_ACTION.down}:${item.id}` },
      { text: digestText(lang, 'hide'), callbackData: `${NS}:${DIGEST_ACTION.hide}:${item.id}` },
    ],
  ];
}

/**
 * Everything about the vacancy except its text: the headline, the two fact
 * lines, how to reach the company, and the model's verdict. Fields are cut to
 * lengths that keep the head comfortably inside one message whatever a scraped
 * posting puts in them.
 */
function renderHead(item: ScoredCandidate, lang: Language, timezone: string): string {
  const lines = [
    `<b>${escapeHtml(cut(item.title, 150))}</b>`,
    escapeHtml(cut(item.company, 80)),
  ];

  const facts = [
    `${item.score}% ${digestText(lang, 'fit')}`,
    salary(item),
    item.location ? cut(item.location, 80) : null,
    item.seniority,
  ].filter((value): value is string => Boolean(value));
  lines.push(facts.map(escapeHtml).join(' · '));

  const meta = [
    item.workFormat ? digestText(lang, `format.${item.workFormat}`) : null,
    item.employmentType ? digestText(lang, `employment.${item.employmentType}`) : null,
    item.publishedAt
      ? `${digestText(lang, 'published')} ${formatDate(item.publishedAt, lang, timezone)}`
      : null,
    item.sourceSlug,
  ].filter((value): value is string => Boolean(value));
  if (meta.length > 0) lines.push(meta.map(escapeHtml).join(' · '));

  // ADR-011 pulls the application contact out of the description; surfacing it
  // here saves reading for the one line that says where to write.
  if (item.applyContact?.value) {
    lines.push(
      `${escapeHtml(digestText(lang, 'contact'))}: ${escapeHtml(cut(item.applyContact.value, 120))}`,
    );
  }

  if (item.note) lines.push('', `<i>${escapeHtml(item.note)}</i>`);
  return lines.join('\n');
}

/**
 * Ingestion stores descriptions as one whitespace-collapsed line (stripHtml),
 * so bullet markers are the only structure left to recover. Giving each its own
 * line turns a wall of text back into the list the posting originally was.
 */
function formatDescription(description: string): string {
  return description
    .replace(/\s+/g, ' ')
    .replace(/\s*([•●▪‣])\s*/g, '\n$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The longest prefix of `text` whose escaped form fits `budget`, cut at a line
 * break, a sentence end or a word boundary — never mid-word, and never inside
 * an HTML entity, since the split happens before escaping.
 */
function takeChunk(text: string, budget: number): [chunk: string, rest: string] {
  if (budget <= 0) return ['', text];
  if (escapeHtml(text).length <= budget) return [text, ''];

  // Escaping only ever grows text, so "fits" is monotonic in the prefix length.
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (escapeHtml(text.slice(0, mid)).length <= budget) low = mid;
    else high = mid - 1;
  }

  const head = text.slice(0, low);
  const end = lastBreak(head) ?? low;
  return [text.slice(0, end).trim(), text.slice(end).trim()];
}

/**
 * Where to cut a full message. Preferences run from cleanest to crudest, but
 * only within the last stretch of the message: chasing a paragraph break all
 * the way back would waste most of a message to save one word.
 */
function lastBreak(text: string): number | null {
  const floor = Math.max(0, text.length - 400);
  for (const marker of ['\n', '. ', ' ']) {
    const at = text.lastIndexOf(marker);
    if (at >= floor) return at + marker.length;
  }
  return null;
}

function formatDate(date: Date, lang: Language, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  };
  try {
    return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', options).format(date);
  } catch {
    // A stored timezone Intl does not know must not cost the whole card.
    return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', {
      ...options,
      timeZone: 'UTC',
    }).format(date);
  }
}

function salary(item: ScoredCandidate): string | null {
  if (!item.salaryMin && !item.salaryMax) return null;
  const range = [item.salaryMin, item.salaryMax].filter(Boolean).join('–');
  return `${range} ${item.salaryCurrency ?? ''}`.trim();
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trim()}…`;
}
