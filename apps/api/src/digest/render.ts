import { BOT_CALLBACK_NAMESPACES, type Language } from '@jobradar/shared';

import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';
import type { ScoredCandidate } from './select';

/** Message text and keyboards for the digest, kept pure and testable. */

/** Telegram refuses anything longer, so a long card is split across messages. */
const MESSAGE_LIMIT = 4096;

/**
 * The posting text rides in a collapsed quote: Telegram shows the first few
 * lines with an expand control, so a ten-vacancy digest reads as ten cards
 * instead of ten walls of text, and the full posting is still one tap away —
 * inside the chat, which is the entire point of carrying it here (v1.20.0).
 *
 * `expandable` is an attribute on `blockquote`, verified against the Bot API
 * itself rather than assumed: an unsupported tag fails the message with
 * `can't parse entities`, and this one parses.
 */
const QUOTE_OPEN = '<blockquote expandable>';
const QUOTE_CLOSE = '</blockquote>';

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
  /** "✅ Applied": puts the vacancy on the user's applications (roadmap 5.5). */
  applied: 'a',
  /** "📥 Send now" (/settings, /digest): every unsent match of the fortnight, on request. */
  now: 'n',
} as const;

const TEXT = {
  en: {
    header: 'Digest: {count} vacancies for you',
    headerOne: 'Digest: one vacancy for you',
    instantHeader: 'New: {count} vacancies for you',
    instantHeaderOne: 'New: one vacancy for you',
    empty: 'Nothing worth your attention today.',
    searching: 'Looking for vacancies…',
    nothingNew: 'Nothing new above your minimum fit. Lower it in /settings to see more.',
    noProfile: 'Nothing to match on yet: send your resume as a PDF and confirm the profile.',
    apply: 'Apply',
    markApplied: '✅ Applied',
    inApplications: '✅ In applications',
    addedToApplications: 'Added to your applications — /applications',
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
    instantHeader: 'Свежее: {count} вакансий для тебя',
    instantHeaderOne: 'Свежее: одна вакансия для тебя',
    empty: 'Сегодня ничего стоящего.',
    searching: 'Ищу вакансии…',
    nothingNew: 'Ничего нового выше твоего минимального соответствия. Понизить его можно в /settings.',
    noProfile: 'Пока не с чем сравнивать: пришли резюме файлом PDF и подтверди профиль.',
    apply: 'Откликнуться',
    markApplied: '✅ Откликнулся',
    inApplications: '✅ В откликах',
    addedToApplications: 'Добавлено в отклики — /applications',
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

/** `instant` marks a push of just-arrived vacancies (ADR-020), not the scheduled digest. */
export function renderHeader(
  lang: Language,
  count: number,
  kind: 'digest' | 'instant' = 'digest',
): string {
  const [one, many] =
    kind === 'instant'
      ? (['instantHeaderOne', 'instantHeader'] as const)
      : (['headerOne', 'header'] as const);
  const template = digestText(lang, count === 1 ? one : many);
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
    // It sits outside the quote, where it stays readable while that is collapsed.
    const tail = last ? `\n\n<i>${escapeHtml(digestText(lang, 'truncated'))}</i>` : '';

    const budget =
      MESSAGE_LIMIT - prefix.length - tail.length - QUOTE_OPEN.length - QUOTE_CLOSE.length;
    const [chunk, remainder] = takeChunk(rest, budget);
    // A budget too small for even one word: stop rather than loop forever.
    if (!chunk) break;

    rest = remainder;
    parts.push(
      `${prefix}${QUOTE_OPEN}${escapeHtml(chunk)}${QUOTE_CLOSE}${rest ? tail : ''}`,
    );
  }

  return parts.length > 0 ? parts : [head];
}

/**
 * One row, two buttons: "Apply", a link to the posting where it was published,
 * and "✅ Applied", which puts the vacancy on the user's applications so
 * `/applications` can track it and remind them to follow up (roadmap 5.5).
 *
 * The developer's call of 2026-10-15 cut the card to the one link: the card
 * already carries the text and the fit, and the only thing left to do with a
 * good vacancy is apply on the board that owns it. On 2026-10-16 the developer
 * added the second button, so applying is recorded from the same card. The
 * in-chat apply flow, the web "Details" page (going away in 2.0.0, ADR-024) and
 * the 👍 / 👎 / Hide buttons stay off the card; their callback handlers stay so
 * buttons on cards already sent keep working.
 *
 * `applied` renders the state after the press: "✅ In applications", whose
 * press is the same idempotent action. A posting without a link still gets
 * the callback button.
 */
export function renderKeyboard(
  item: Pick<ScoredCandidate, 'id' | 'url'>,
  lang: Language,
  applied = false,
): InlineKeyboard {
  const row: InlineKeyboard[number] = [];
  if (item.url) row.push({ text: digestText(lang, 'apply'), url: item.url });
  row.push({
    text: digestText(lang, applied ? 'inApplications' : 'markApplied'),
    callbackData: `${BOT_CALLBACK_NAMESPACES.digest}:${DIGEST_ACTION.applied}:${item.id}`,
  });
  return [row];
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
 * an HTML entity, since the split happens before escaping. Also splits long
 * LLM output across messages in `/interview`.
 */
export function takeChunk(text: string, budget: number): [chunk: string, rest: string] {
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
