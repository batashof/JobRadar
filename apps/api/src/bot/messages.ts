import { type Language } from '@jobradar/shared';

/**
 * Bot-facing strings in the account language (ADR-014). Same approach as
 * `planner/labels.ts`: a small local map, not an i18n runtime — these are a
 * dozen strings and ADR-001 keeps dependencies out.
 *
 * The `/start` replies are the exception to the account-language rule: at that
 * point no account is known yet, so they answer in Russian with an English
 * line, matching the two languages the product supports.
 */

const STRINGS = {
  en: {
    'link.done': 'Linked. JobRadar will write here — nudges and the daily digest.',
    'link.already': 'This chat is already linked to your JobRadar account.',
    'link.expired': 'The link has expired. Open Settings in JobRadar and generate a new one.',
    'link.unknown': 'Unknown link. Open Settings in JobRadar and generate a new one.',
    'link.taken': 'This chat is already linked to another JobRadar account.',
    'start.plain': 'This is the JobRadar bot. To link it, open Settings in the app and press "Connect Telegram".',
    'stop.done': 'Unlinked. Messages stopped. Link again from Settings whenever you want.',
    'stop.notLinked': 'This chat is not linked to any JobRadar account.',
    'help': 'Commands: /start — link, /stop — unlink, /help — this text.',
    'unknown': 'Unknown command. /help lists what I understand.',
    'callback.stale': 'This message is out of date — open the app.',
    'callback.failed': 'Could not do that. Try in the app.',
  },
  ru: {
    'link.done': 'Подключено. JobRadar будет писать сюда — напоминания и суточная выжимка.',
    'link.already': 'Этот чат уже привязан к твоему аккаунту JobRadar.',
    'link.expired': 'Ссылка устарела. Открой настройки в JobRadar и создай новую.',
    'link.unknown': 'Неизвестная ссылка. Открой настройки в JobRadar и создай новую.',
    'link.taken': 'Этот чат уже привязан к другому аккаунту JobRadar.',
    'start.plain': 'Это бот JobRadar. Чтобы подключить, открой настройки в приложении и нажми «Подключить Telegram».',
    'stop.done': 'Отключено. Сообщений больше не будет. Подключить снова можно в настройках.',
    'stop.notLinked': 'Этот чат не привязан ни к одному аккаунту JobRadar.',
    'help': 'Команды: /start — подключить, /stop — отключить, /help — этот текст.',
    'unknown': 'Неизвестная команда. /help покажет, что я понимаю.',
    'callback.stale': 'Сообщение устарело — открой приложение.',
    'callback.failed': 'Не получилось. Попробуй в приложении.',
  },
} as const;

export type BotMessageKey = keyof (typeof STRINGS)['en'];

export function botMessage(lang: Language, key: BotMessageKey): string {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key];
}

/** Fallback for replies sent before any account is known (`/start` with a bad token). */
export const DEFAULT_BOT_LANGUAGE: Language = 'ru';
