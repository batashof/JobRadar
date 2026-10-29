import type { Language } from '@jobradar/shared';

import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';
import { languageLabel, vacancyLanguageList } from '../matching/work-language';
import type { CardFit, ScoredCandidate } from './select';

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
  /** "✅ Applied" (roadmap 5.5): no longer sent since v2.5.1, still answered on older cards. */
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
    nothingNew: 'Nothing new above your minimum fit. Lower it in /filters to see more.',
    noProfile: 'Nothing to match on yet: send your resume as a PDF and confirm the profile.',
    apply: 'Apply',
    applyVia: 'Apply via {source}',
    companySite: 'the company site',
    grade: 'Grade',
    addedToApplications: 'Added to your applications — /applications',
    details: 'Details',
    source: 'Original',
    hide: 'Hide',
    hidden: 'Hidden — it will not come back.',
    liked: 'Noted: more like this.',
    disliked: 'Noted: fewer like this.',
    fit: 'fit',
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
    nothingNew: 'Ничего нового выше твоего минимального соответствия. Понизить его можно в /filters.',
    noProfile: 'Пока не с чем сравнивать: пришли резюме файлом PDF и подтверди профиль.',
    apply: 'Откликнуться',
    applyVia: 'Откликнуться через {source}',
    companySite: 'сайт компании',
    grade: 'Грейд',
    addedToApplications: 'Добавлено в отклики — /applications',
    details: 'Подробнее',
    source: 'Первоисточник',
    hide: 'Скрыть',
    hidden: 'Скрыто — больше не появится.',
    liked: 'Принято: больше такого.',
    disliked: 'Принято: меньше такого.',
    fit: 'соответствие',
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
 * One full-width button, "Apply via <board>", linking the posting where it
 * was published. On 2026-10-17 the developer dropped the "✅ Applied" button
 * that shared the row (v2.5.1): two buttons in one row cut "Откликнуться через
 * DOU" on a phone. Its callback handler (`d:a:<id>`) stays, so the button on
 * cards already sent keeps working; the in-chat apply flow and the 👍 / 👎 /
 * Hide buttons are off the card for the same reason. A posting without a link
 * gets no keyboard.
 */
export function renderKeyboard(
  item: Pick<ScoredCandidate, 'url'> & { sourceSlug?: string | null },
  lang: Language,
): InlineKeyboard {
  if (!item.url) return [];
  return [[{ text: applyLabel(item.sourceSlug ?? null, lang), url: item.url }]];
}

/**
 * Board names for the Apply button ("Apply via DOU"), by source slug. A slug
 * not listed is shown capitalised; `ats` covers the companies' own career
 * sites (Greenhouse, Lever, SmartRecruiters…), so it reads as "the company site".
 */
const SOURCE_NAMES: Record<string, string> = {
  dou: 'DOU',
  djinni: 'Djinni',
  linkedin: 'LinkedIn',
  remoteok: 'RemoteOK',
  remotive: 'Remotive',
  weworkremotely: 'We Work Remotely',
  himalayas: 'Himalayas',
  jobicy: 'Jobicy',
  hn: 'Hacker News',
  telegram: 'Telegram',
  hh: 'hh.ru',
};

export function applyLabel(sourceSlug: string | null, lang: Language): string {
  if (!sourceSlug) return digestText(lang, 'apply');
  const name =
    sourceSlug === 'ats'
      ? digestText(lang, 'companySite')
      : (SOURCE_NAMES[sourceSlug] ?? sourceSlug[0]!.toUpperCase() + sourceSlug.slice(1));
  return digestText(lang, 'applyVia').replace('{source}', name);
}

const FORMAT_ICON = { remote: '🌍', hybrid: '🔀', onsite: '🏙' } as const;
const GRADE_ICON: Record<CardFit['grade'], string> = {
  match: '✅',
  above: '⬆️',
  below: '⬇️',
  far: '❌',
  unknown: '',
};

/** 🟢 / 🟡 / 🟠 by fit: Telegram has no coloured text, so the dot carries the colour. */
function fitDot(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  return '🟠';
}

/**
 * Everything about the vacancy except its text (v2.5.0 layout): the title;
 * the company with the publication date and time; the location; the format
 * and employment; salary and grade; the fit with what matched (✅), what is
 * adjacent (🟡) and what is missing (❌), each on its own row; the contact.
 * Telegram cannot align text right or colour it, so the date follows the
 * company after a separator and emoji carry the colour. Fields are cut to
 * lengths that keep the head inside one message whatever a posting holds.
 */
function renderHead(item: ScoredCandidate, lang: Language, timezone: string): string {
  const lines = [`💼 <b>${escapeHtml(cut(item.title, 150))}</b>`];

  const date = item.publishedAt ? `🗓 ${formatDate(item.publishedAt, timezone)}` : null;
  lines.push([`🏢 ${escapeHtml(cut(item.company, 80))}`, date].filter(Boolean).join('  ·  '));

  if (item.location?.trim()) lines.push(`📍 ${escapeHtml(cut(item.location.trim(), 80))}`);

  const kind = [
    item.workFormat ? `${FORMAT_ICON[item.workFormat]} ${digestText(lang, `format.${item.workFormat}`)}` : null,
    item.employmentType ? `⏱ ${digestText(lang, `employment.${item.employmentType}`)}` : null,
  ].filter((value): value is string => Boolean(value));
  if (kind.length > 0) lines.push(escapeHtml(kind.join('  ·  ')));

  // The language the work is in (v2.7.0): a posting written in Spanish says
  // so before the reader opens it.
  const languages = item.languages ? vacancyLanguageList(item.languages) : [];
  if (languages.length > 0) {
    lines.push(`🗣 ${escapeHtml(languages.map((code) => languageLabel(code, lang)).join(', '))}`);
  }

  const pay = salary(item);
  const grade = item.seniority
    ? `🎚 ${capitalise(item.seniority)}${item.fit && GRADE_ICON[item.fit.grade] ? ` ${GRADE_ICON[item.fit.grade]}` : ''}`
    : null;
  const money = [pay ? `💰 ${pay}` : null, grade].filter((value): value is string => Boolean(value));
  if (money.length > 0) lines.push(escapeHtml(money.join('  ·  ')));

  lines.push('', `${fitDot(item.score)} <b>${item.score}%</b> ${escapeHtml(digestText(lang, 'fit'))}`);
  if (item.fit) {
    const row = (icon: string, names: string[]) =>
      names.length > 0 ? `${icon} ${escapeHtml(names.join(', '))}` : null;
    lines.push(
      ...[
        row('✅', item.fit.matched.slice(0, 6)),
        row('🟡', item.fit.related.slice(0, 4)),
        row('❌', item.fit.missing),
      ].filter((value): value is string => Boolean(value)),
    );
  } else if (item.note) {
    lines.push(`<i>${escapeHtml(item.note)}</i>`);
  }

  // ADR-011 pulls the application contact out of the description; surfacing it
  // here saves reading for the one line that says where to write.
  if (item.applyContact?.value) {
    lines.push(
      '',
      `📨 ${escapeHtml(digestText(lang, 'contact'))}: ${escapeHtml(cut(item.applyContact.value, 120))}`,
    );
  }
  return lines.join('\n');
}

function capitalise(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
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

/** "16.10.2026, 14:30" in the user's timezone: digits only, the same in both languages. */
function formatDate(date: Date, timezone: string): string {
  const parts = (zone: string) => {
    const values: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: zone,
    }).formatToParts(date)) {
      values[part.type] = part.value;
    }
    return `${values.day}.${values.month}.${values.year}, ${values.hour}:${values.minute}`;
  };
  try {
    return parts(timezone);
  } catch {
    // A stored timezone Intl does not know must not cost the whole card.
    return parts('UTC');
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
