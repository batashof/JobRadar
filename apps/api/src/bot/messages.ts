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
      'JobRadar finds remote IT vacancies that fit your resume, or the parameters you set without one, and sends them here.\n\n' +
      '/start — create your account or reconnect this chat\n' +
      '/setup — first steps: a checklist for a start\n' +
      '/resume — your resume: add or replace it\n' +
      '/noresume — without a resume: set role, grade and skills by hand\n' +
      '/digest — send every new matching vacancy now\n' +
      '/filters — which vacancies to send: role, grade, skills, salary, format\n' +
      '/settings — when to send: delivery, timezone, language, pause\n' +
      '/applications — your job applications: stages and follow-up reminders\n' +
      '/linkedin — receive vacancies from your own LinkedIn job alerts\n' +
      '/privacy — what is stored and who sees it\n' +
      '/delete — delete your account and everything in it\n' +
      '/stop — stop messages without deleting anything\n' +
      '/feedback — tell the author what is wrong or missing\n' +
      '/help — this text',
    /** Appended to `help` for the owner only (ADR-024 §3). */
    'help.owner': 'Author tools:\n/interview — interview prep: topic plan, questions by topic, mock interview\n/plan — the day plan: compose, blocks, close the day\n/gmail — connect Gmail for sending applications\n/testmode — go through sign-up as a new user, then come back\n/stats — users, the sign-up funnel, sources and errors',
    /** Sent to the owner when a user hits a failure (v2.6.0). */
    'owner.error': '⚠️ Bot error: {where}\nUser: {user}\n{message}',
    'start.welcome':
      'Welcome to JobRadar. Your account is created: no email and no password, this chat is your login.\n\n' +
      'Next step: send your resume here as a PDF file (📎 → File). I will evaluate it and build your profile for picking vacancies.\n\n' +
      'No resume, or rather not share it? /noresume: pick the role, grade and skills by hand, nothing personal is asked.\n\n' +
      '/setup walks you through the rest step by step.',
    'start.back': 'Welcome back. This chat is connected to your JobRadar account again.',
    'privacy':
      'What JobRadar stores: your Telegram id, username and chat id, the interface language, when you last used the bot, your resume (the PDF and its text) if you upload one, the profile built from it or from the parameters you set with /noresume, the vacancies sent to you, your reactions to them and the applications you track (/applications). If you forward your LinkedIn job alerts (/linkedin), JobRadar reads those emails for the vacancies in them.\n\n' +
      'Who sees it: only JobRadar. To read your resume, its text is sent once to an AI provider that does not train on it. What you send with /feedback is read by the author of the bot. Nothing is sold or shared.\n\n' +
      'How long: until you delete it. /delete removes the account and everything in it at once.\n\n' +
      'Full policy: https://job-radar-web-phi.vercel.app/privacy',
    'delete.confirm': 'Delete your JobRadar account? Your settings, resume and vacancy history are removed for good.',
    'delete.yes': 'Delete everything',
    'delete.no': 'Cancel',
    'delete.done': 'Your account and everything in it are deleted. /start creates a new one.',
    'delete.cancelled': 'Nothing was deleted.',
    'testmode.confirm':
      'Test mode: this chat is unlinked from your owner account, and /start then creates a fresh empty account, exactly as a new user gets. Nothing of yours is deleted, but your own vacancies stop arriving while the test runs. Way back: /delete in the test account, then /start.',
    'testmode.yes': 'Start the test',
    'testmode.no': 'Cancel',
    'testmode.cancelled': 'Test mode not started.',
    'testmode.on': 'Done. This chat is no longer linked to the owner account. Send /start to sign up as a new user. Way back: /delete, then /start.',
    'testmode.off': 'Welcome back. This chat is linked to the owner account again; your vacancies arrive here as before.',
    'delete.owner': 'The owner account cannot be deleted from the chat.',
    'delete.notLinked': 'This chat has no JobRadar account.',
    'callback.ownerOnly': 'Available to the JobRadar owner only.',
    'text.noAccount': 'Press /start first to create your JobRadar account.',
    'text.noDialog': 'Send your resume as a PDF file (📎 → File), or /help for the commands.',
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
      'JobRadar находит удалённые IT-вакансии под твоё резюме или под параметры, заданные без него, и присылает их сюда.\n\n' +
      '/start — создать аккаунт или снова подключить этот чат\n' +
      '/setup — первые шаги: чек-лист для начала\n' +
      '/resume — твоё резюме: добавить или заменить\n' +
      '/noresume — без резюме: задать роль, грейд и навыки вручную\n' +
      '/digest — прислать все новые подходящие вакансии сейчас\n' +
      '/filters — какие вакансии присылать: роль, грейд, навыки, зарплата, формат\n' +
      '/settings — когда присылать: доставка, часовой пояс, язык, пауза\n' +
      '/applications — твои отклики: этапы и напоминания написать компании\n' +
      '/linkedin — вакансии из твоих оповещений LinkedIn\n' +
      '/privacy — что хранится и кто это видит\n' +
      '/delete — удалить аккаунт и всё, что в нём\n' +
      '/stop — остановить сообщения, ничего не удаляя\n' +
      '/feedback — написать автору, что не так или чего не хватает\n' +
      '/help — этот текст',
    'help.owner':
      'Инструменты автора:\n/interview — подготовка к собеседованию: план тем, вопросы по темам, пробное собеседование\n/plan — план дня: составить, блоки, закрыть день\n/gmail — подключить Gmail для отправки откликов\n/testmode — пройти регистрацию как новый пользователь и вернуться\n/stats — пользователи, воронка регистрации, источники и ошибки',
    'owner.error': '⚠️ Ошибка в боте: {where}\nПользователь: {user}\n{message}',
    'start.welcome':
      'Добро пожаловать в JobRadar. Аккаунт создан: без почты и пароля, вход — этот чат.\n\n' +
      'Следующий шаг: пришли сюда резюме файлом PDF (📎 → Файл). Я оценю его и соберу профиль для подбора вакансий.\n\n' +
      'Нет резюме или не хочешь им делиться? /noresume: роль, грейд и навыки выбираются вручную, ничего личного не спрашиваю.\n\n' +
      '/setup проведёт по остальным шагам.',
    'start.back': 'С возвращением. Этот чат снова подключён к твоему аккаунту JobRadar.',
    'privacy':
      'Что хранит JobRadar: твой Telegram id, username и id чата, язык интерфейса, время последнего действия в боте, резюме (PDF и его текст), если ты его загрузишь, профиль, собранный по нему или по параметрам из /noresume, отправленные тебе вакансии, твои реакции на них и отклики, которые ты отмечаешь (/applications). Если ты пересылаешь оповещения LinkedIn (/linkedin), JobRadar читает эти письма, чтобы достать из них вакансии.\n\n' +
      'Кто это видит: только JobRadar. Чтобы прочитать резюме, его текст один раз отправляется AI-провайдеру, который на нём не обучается. То, что ты пишешь в /feedback, читает автор бота. Ничего не продаётся и не передаётся.\n\n' +
      'Сколько хранится: пока ты сам не удалишь. /delete сразу удаляет аккаунт и всё, что в нём.\n\n' +
      'Полная политика: https://job-radar-web-phi.vercel.app/privacy',
    'delete.confirm': 'Удалить аккаунт JobRadar? Настройки, резюме и история вакансий удалятся навсегда.',
    'delete.yes': 'Удалить всё',
    'delete.no': 'Отмена',
    'delete.done': 'Аккаунт и всё, что в нём, удалены. /start создаст новый.',
    'delete.cancelled': 'Ничего не удалено.',
    'testmode.confirm':
      'Тестовый режим: этот чат отвяжется от аккаунта владельца, и /start создаст новый пустой аккаунт, ровно как у нового пользователя. Твои данные не удаляются, но пока идёт тест, вакансии на основной аккаунт не приходят. Вернуться: /delete в тестовом аккаунте, затем /start.',
    'testmode.yes': 'Начать тест',
    'testmode.no': 'Отмена',
    'testmode.cancelled': 'Тестовый режим не включён.',
    'testmode.on': 'Готово. Этот чат больше не привязан к аккаунту владельца. Отправь /start, чтобы зарегистрироваться как новый пользователь. Вернуться: /delete, затем /start.',
    'testmode.off': 'С возвращением. Чат снова привязан к аккаунту владельца, вакансии приходят как раньше.',
    'delete.owner': 'Аккаунт владельца нельзя удалить из чата.',
    'delete.notLinked': 'У этого чата нет аккаунта JobRadar.',
    'callback.ownerOnly': 'Доступно только владельцу JobRadar.',
    'text.noAccount': 'Сначала нажми /start, чтобы создать аккаунт JobRadar.',
    'text.noDialog': 'Пришли резюме файлом PDF (📎 → Файл) или набери /help, чтобы увидеть команды.',
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
