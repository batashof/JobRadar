import { BOT_CALLBACK_NAMESPACES, type Language } from '@jobradar/shared';

import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';
import type { ScoredCandidate } from './select';

/** Message text and keyboards for the digest, kept pure and testable. */

const NS = BOT_CALLBACK_NAMESPACES.digest;

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
    hide: 'Hide',
    hidden: 'Hidden — it will not come back.',
    liked: 'Noted: more like this.',
    disliked: 'Noted: fewer like this.',
    fit: 'fit',
  },
  ru: {
    header: 'Выжимка: {count} вакансий для тебя',
    headerOne: 'Выжимка: одна вакансия для тебя',
    empty: 'Сегодня ничего стоящего.',
    apply: 'Откликнуться',
    details: 'Подробнее',
    hide: 'Скрыть',
    hidden: 'Скрыто — больше не появится.',
    liked: 'Принято: больше такого.',
    disliked: 'Принято: меньше такого.',
    fit: 'соответствие',
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
 * One card per vacancy. Everything interpolated is source data — titles and
 * companies come from scraped descriptions, so all of it is escaped.
 */
export function renderCard(item: ScoredCandidate, lang: Language): string {
  const lines = [
    `<b>${escapeHtml(item.title)}</b>`,
    escapeHtml(item.company),
  ];

  const facts = [
    `${item.score}% ${digestText(lang, 'fit')}`,
    salary(item),
    item.location,
  ].filter((value): value is string => Boolean(value));
  lines.push(facts.map(escapeHtml).join(' · '));

  if (item.note) lines.push('', `<i>${escapeHtml(item.note)}</i>`);
  return lines.join('\n');
}

/**
 * Apply is a callback, not a link: the whole point is not having to leave the
 * chat. It is namespaced to `a:` (outreach), so this module renders the button
 * without knowing anything about how applying works. Details stays a link to
 * the original posting — reading the full text is a browser job.
 */
export function renderKeyboard(
  item: ScoredCandidate,
  lang: Language,
  webOrigin: string,
): InlineKeyboard {
  const appUrl = webOrigin ? `${webOrigin}/app/vacancies/${item.id}` : item.url;
  return [
    [
      {
        text: digestText(lang, 'apply'),
        callbackData: `${BOT_CALLBACK_NAMESPACES.apply}:d:${item.id}`,
      },
      { text: digestText(lang, 'details'), url: appUrl },
    ],
    [
      { text: '👍', callbackData: `${NS}:${DIGEST_ACTION.up}:${item.id}` },
      { text: '👎', callbackData: `${NS}:${DIGEST_ACTION.down}:${item.id}` },
      { text: digestText(lang, 'hide'), callbackData: `${NS}:${DIGEST_ACTION.hide}:${item.id}` },
    ],
  ];
}

function salary(item: ScoredCandidate): string | null {
  if (!item.salaryMin && !item.salaryMax) return null;
  const range = [item.salaryMin, item.salaryMax].filter(Boolean).join('–');
  return `${range} ${item.salaryCurrency ?? ''}`.trim();
}
