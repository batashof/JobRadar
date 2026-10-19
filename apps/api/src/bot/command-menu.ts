import type { Language } from '@jobradar/shared';

/** One entry of Telegram's command menu (`setMyCommands`). */
export interface MenuCommand {
  command: string;
  description: string;
}

type Descriptions = Record<Language, string>;

/**
 * Every command a user can send, in menu order (roadmap 5.7). The bot's own
 * commands and the feature modules' `registerCommand` names both belong here;
 * `command-menu.spec.ts` fails when a registered command is missing.
 */
export const PUBLIC_COMMANDS: readonly [string, Descriptions][] = [
  ['start', { en: 'Create your account or reconnect this chat', ru: 'Создать аккаунт или подключить чат' }],
  ['setup', { en: 'First steps: a checklist for a start', ru: 'Первые шаги: чек-лист для начала' }],
  ['resume', { en: 'Add or replace your resume', ru: 'Добавить или заменить резюме' }],
  ['digest', { en: 'Send matching vacancies now', ru: 'Прислать подходящие вакансии сейчас' }],
  ['filters', { en: 'Which vacancies to send: role, skills, salary, format', ru: 'Какие вакансии присылать: роль, навыки, зарплата, формат' }],
  ['settings', { en: 'When to send: delivery, timezone, language, pause', ru: 'Когда присылать: доставка, часовой пояс, язык, пауза' }],
  ['applications', { en: 'Your applications and reminders', ru: 'Твои отклики и напоминания' }],
  ['linkedin', { en: 'Vacancies from your LinkedIn alerts', ru: 'Вакансии из оповещений LinkedIn' }],
  ['privacy', { en: 'What is stored and who sees it', ru: 'Что хранится и кто это видит' }],
  ['delete', { en: 'Delete your account', ru: 'Удалить аккаунт' }],
  ['stop', { en: 'Stop messages', ru: 'Остановить сообщения' }],
  ['feedback', { en: 'Tell the author what is wrong or missing', ru: 'Написать автору: что не так, чего не хватает' }],
  ['help', { en: 'What the bot can do', ru: 'Что умеет бот' }],
];

/** Shown in the owner's chat only (ADR-024 §3): the LLM-per-action and credential tools. */
export const OWNER_COMMANDS: readonly [string, Descriptions][] = [
  ['interview', { en: 'Interview prep', ru: 'Подготовка к собеседованию' }],
  ['plan', { en: 'The day plan', ru: 'План дня' }],
  ['gmail', { en: 'Connect Gmail', ru: 'Подключить Gmail' }],
  ['testmode', { en: 'Sign up as a new user, then come back', ru: 'Пройти регистрацию как новый пользователь' }],
  ['stats', { en: 'Users, funnel, sources, errors', ru: 'Пользователи, воронка, источники, ошибки' }],
];

/** The menu for one language; the owner's adds the author tools before /help. */
export function menuCommands(lang: Language, owner = false): MenuCommand[] {
  const toEntry = ([command, text]: [string, Descriptions]): MenuCommand => ({
    command,
    description: text[lang],
  });
  const pub = PUBLIC_COMMANDS.map(toEntry);
  if (!owner) return pub;
  const help = pub.pop() as MenuCommand;
  return [...pub, ...OWNER_COMMANDS.map(toEntry), help];
}
