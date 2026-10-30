import type { Language } from '@jobradar/shared';

/** One entry of Telegram's command menu (`setMyCommands`). */
export interface MenuCommand {
  command: string;
  description: string;
}

type Descriptions = Record<Language, string>;

/**
 * The menus (roadmap 5.20). Telegram has no "registered users" scope, so the
 * default menu is the one a chat without an account sees, and every linked
 * chat gets its own (`chat` scope) without /start. The owner's adds the author
 * tools. `command-menu.spec.ts` fails when a command the bot answers is in no
 * menu and not in `HIDDEN_COMMANDS`.
 */

/** A chat with no account: the default scope. */
export const GUEST_COMMANDS: readonly [string, Descriptions][] = [
  ['start', { en: 'Create your account or reconnect this chat', ru: 'Создать аккаунт или подключить чат' }],
  ['help', { en: 'What the bot can do', ru: 'Что умеет бот' }],
  ['privacy', { en: 'What is stored and who sees it', ru: 'Что хранится и кто это видит' }],
];

/** A linked chat, in menu order. */
export const PUBLIC_COMMANDS: readonly [string, Descriptions][] = [
  ['setup', { en: 'First steps: a checklist for a start', ru: 'Первые шаги: чек-лист для начала' }],
  ['digest', { en: 'Send matching vacancies now', ru: 'Прислать подходящие вакансии сейчас' }],
  ['settings', { en: 'Settings: profile, resume, filters, delivery', ru: 'Настройки: профиль, резюме, фильтры, доставка' }],
  ['help', { en: 'What the bot can do', ru: 'Что умеет бот' }],
  ['privacy', { en: 'What is stored and who sees it', ru: 'Что хранится и кто это видит' }],
  ['feedback', { en: 'Tell the author what is wrong or missing', ru: 'Написать автору: что не так, чего не хватает' }],
  ['delete', { en: 'Delete your account', ru: 'Удалить аккаунт' }],
];

/** Added to the owner's chat only (ADR-024 §3). */
export const OWNER_COMMANDS: readonly [string, Descriptions][] = [
  ['stats', { en: 'Users, funnel, sources, errors', ru: 'Пользователи, воронка, источники, ошибки' }],
  ['triage', { en: 'Bugs and feedback to fix', ru: 'Баги и отзывы: что фиксить' }],
  ['testmode', { en: 'Sign up as a new user, then come back', ru: 'Пройти регистрацию как новый пользователь' }],
];

/**
 * Commands the bot still answers but no menu lists (roadmap 5.20): reached
 * from /settings (`resume`, `filters`, `interview` for the owner, pause instead
 * of `stop`), or hidden for now with their code kept (`noresume`,
 * `applications`, `linkedin`, `plan`, `gmail`).
 */
export const HIDDEN_COMMANDS: readonly string[] = [
  'resume',
  'filters',
  'stop',
  'noresume',
  'applications',
  'linkedin',
];

/** Hidden author tools: they refuse anyone but the owner. */
export const HIDDEN_OWNER_COMMANDS: readonly string[] = ['interview', 'plan', 'gmail'];

const toEntry =
  (lang: Language) =>
  ([command, text]: readonly [string, Descriptions]): MenuCommand => ({
    command,
    description: text[lang],
  });

/** The default menu, for a chat that has no account yet. */
export function guestMenu(lang: Language): MenuCommand[] {
  return GUEST_COMMANDS.map(toEntry(lang));
}

/** The menu of a linked chat; the owner's adds the author tools at the end. */
export function menuCommands(lang: Language, owner = false): MenuCommand[] {
  const entries = owner ? [...PUBLIC_COMMANDS, ...OWNER_COMMANDS] : PUBLIC_COMMANDS;
  return entries.map(toEntry(lang));
}
