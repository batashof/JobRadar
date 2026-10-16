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
    'link.already': 'This chat is already linked to your JobRadar account. /help lists the commands.',
    'link.expired': 'The link has expired. Open Settings in JobRadar and generate a new one.',
    'link.unknown': 'Unknown link. Open Settings in JobRadar and generate a new one.',
    'link.taken': 'This Telegram account already has another JobRadar account. Delete it with /delete first.',
    'stop.done': 'Unlinked. Messages stopped. Link again from Settings whenever you want.',
    'stop.notLinked': 'This chat is not linked to any JobRadar account.',
    'help':
      'JobRadar finds remote IT vacancies that fit your resume and sends them here.\n\n' +
      '/start — create your account or reconnect this chat\n' +
      '/settings — delivery, filters, timezone, language, pause\n' +
      '/applications — your job applications: stages and follow-up reminders\n' +
      '/linkedin — receive vacancies from your own LinkedIn job alerts\n' +
      '/privacy — what is stored and who sees it\n' +
      '/delete — delete your account and everything in it\n' +
      '/stop — stop messages without deleting anything\n' +
      '/help — this text',
    /** Appended to `help` for the owner only (ADR-024 §3). */
    'help.owner': 'Author tools:\n/interview — interview prep: topic plan, questions by topic, mock interview\n/plan — the day plan: compose, blocks, close the day\n/gmail — connect Gmail for sending applications',
    'start.welcome':
      'Welcome to JobRadar. Your account is created: no email and no password, this chat is your login.\n\n' +
      'Next step: send your resume here as a PDF file. I will evaluate it and build your profile for picking vacancies.',
    'start.back': 'Welcome back. This chat is connected to your JobRadar account again.',
    'privacy':
      'What JobRadar stores: your Telegram id, username and chat id, the interface language, and later your resume (the PDF and its text), the profile built from it, the vacancies sent to you, your reactions to them and the applications you track (/applications). If you forward your LinkedIn job alerts (/linkedin), JobRadar reads those emails for the vacancies in them.\n\n' +
      'Who sees it: only JobRadar. To read your resume, its text is sent once to an AI provider that does not train on it. Nothing is sold or shared.\n\n' +
      'How long: until you delete it. /delete removes the account and everything in it at once.\n\n' +
      'Full policy: https://job-radar-web-phi.vercel.app/privacy',
    'delete.confirm': 'Delete your JobRadar account? Your settings, resume and vacancy history are removed for good.',
    'delete.yes': 'Delete everything',
    'delete.no': 'Cancel',
    'delete.done': 'Your account and everything in it are deleted. /start creates a new one.',
    'delete.cancelled': 'Nothing was deleted.',
    'delete.owner': 'The owner account cannot be deleted from the chat.',
    'delete.notLinked': 'This chat has no JobRadar account.',
    'callback.ownerOnly': 'Available to the JobRadar owner only.',
    'text.noAccount': 'Press /start first to create your JobRadar account.',
    'text.noDialog': 'Send your resume as a PDF, or /help for the commands.',
    'unknown': 'Unknown command. /help lists what I understand.',
    'callback.stale': 'This message is out of date — open the app.',
    'callback.failed': 'Could not do that. Try again later.',
  },
  ru: {
    'link.done': 'Подключено. JobRadar будет писать сюда — напоминания и суточная выжимка.',
    'link.already': 'Этот чат уже привязан к твоему аккаунту JobRadar. /help покажет команды.',
    'link.expired': 'Ссылка устарела. Открой настройки в JobRadar и создай новую.',
    'link.unknown': 'Неизвестная ссылка. Открой настройки в JobRadar и создай новую.',
    'link.taken': 'У этого Telegram-аккаунта уже есть другой аккаунт JobRadar. Сначала удали его через /delete.',
    'stop.done': 'Отключено. Сообщений больше не будет. Подключить снова можно в настройках.',
    'stop.notLinked': 'Этот чат не привязан ни к одному аккаунту JobRadar.',
    'help':
      'JobRadar находит удалённые IT-вакансии под твоё резюме и присылает их сюда.\n\n' +
      '/start — создать аккаунт или снова подключить этот чат\n' +
      '/settings — доставка, фильтры, часовой пояс, язык, пауза\n' +
      '/applications — твои отклики: этапы и напоминания написать компании\n' +
      '/linkedin — вакансии из твоих оповещений LinkedIn\n' +
      '/privacy — что хранится и кто это видит\n' +
      '/delete — удалить аккаунт и всё, что в нём\n' +
      '/stop — остановить сообщения, ничего не удаляя\n' +
      '/help — этот текст',
    'help.owner':
      'Инструменты автора:\n/interview — подготовка к собеседованию: план тем, вопросы по темам, пробное собеседование\n/plan — план дня: составить, блоки, закрыть день\n/gmail — подключить Gmail для отправки откликов',
    'start.welcome':
      'Добро пожаловать в JobRadar. Аккаунт создан: без почты и пароля, вход — этот чат.\n\n' +
      'Следующий шаг: пришли сюда резюме файлом PDF. Я оценю его и соберу профиль для подбора вакансий.',
    'start.back': 'С возвращением. Этот чат снова подключён к твоему аккаунту JobRadar.',
    'privacy':
      'Что хранит JobRadar: твой Telegram id, username и id чата, язык интерфейса, а позже резюме (PDF и его текст), профиль, собранный по нему, отправленные тебе вакансии, твои реакции на них и отклики, которые ты отмечаешь (/applications). Если ты пересылаешь оповещения LinkedIn (/linkedin), JobRadar читает эти письма, чтобы достать из них вакансии.\n\n' +
      'Кто это видит: только JobRadar. Чтобы прочитать резюме, его текст один раз отправляется AI-провайдеру, который на нём не обучается. Ничего не продаётся и не передаётся.\n\n' +
      'Сколько хранится: пока ты сам не удалишь. /delete сразу удаляет аккаунт и всё, что в нём.\n\n' +
      'Полная политика: https://job-radar-web-phi.vercel.app/privacy',
    'delete.confirm': 'Удалить аккаунт JobRadar? Настройки, резюме и история вакансий удалятся навсегда.',
    'delete.yes': 'Удалить всё',
    'delete.no': 'Отмена',
    'delete.done': 'Аккаунт и всё, что в нём, удалены. /start создаст новый.',
    'delete.cancelled': 'Ничего не удалено.',
    'delete.owner': 'Аккаунт владельца нельзя удалить из чата.',
    'delete.notLinked': 'У этого чата нет аккаунта JobRadar.',
    'callback.ownerOnly': 'Доступно только владельцу JobRadar.',
    'text.noAccount': 'Сначала нажми /start, чтобы создать аккаунт JobRadar.',
    'text.noDialog': 'Пришли резюме в PDF или набери /help, чтобы увидеть команды.',
    'unknown': 'Неизвестная команда. /help покажет, что я понимаю.',
    'callback.stale': 'Сообщение устарело — открой приложение.',
    'callback.failed': 'Не получилось. Попробуй позже.',
  },
} as const;

export type BotMessageKey = keyof (typeof STRINGS)['en'];

export function botMessage(lang: Language, key: BotMessageKey): string {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key];
}

/** Fallback for replies sent before any account is known (`/start` with a bad token). */
export const DEFAULT_BOT_LANGUAGE: Language = 'ru';
