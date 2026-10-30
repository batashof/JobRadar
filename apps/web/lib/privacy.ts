import type { Language } from '@jobradar/shared';

/**
 * The privacy policy the bot links to from `/privacy` and BotFather
 * (ADR-024 §7–8). The wording follows the bot's own `/privacy` reply
 * (apps/api/src/bot/messages.ts) and ADR-025 (which provider sees a resume).
 */
export const BOT_URL = 'https://t.me/JobRadarAppBot';

export interface PrivacyText {
  title: string;
  intro: string;
  openInTelegram: string;
  sections: { title: string; paragraphs?: string[]; items?: string[] }[];
}

const en: PrivacyText = {
  title: 'Privacy policy',
  intro: 'This policy covers the JobRadar Telegram bot @JobRadarAppBot.',
  openInTelegram: 'Open in Telegram',
  sections: [
    {
      title: 'What JobRadar stores',
      items: [
        'Your Telegram user id, username and chat id.',
        'The interface language and your settings (delivery, filters, quiet hours, sources).',
        'Your resume: the PDF file and the text extracted from it.',
        'The candidate profile built from the resume.',
        'The vacancies sent to you and your reactions to them.',
        'The applications you track in /applications.',
        'If you forward your LinkedIn job alerts (/linkedin), JobRadar reads those emails for the vacancies in them.',
        'What you write with /feedback, until the author has handled it.',
      ],
    },
    {
      title: 'Who sees it',
      paragraphs: [
        'Only JobRadar. Nothing is sold or shared.',
        'To read your resume, its text is sent once per upload to an AI provider: Groq by default. Providers that ' +
          'train on submitted data never receive your resume. Vacancies are scored by a formula inside JobRadar; ' +
          'your resume is not sent to an AI provider for that.',
        'What you write with /feedback is read by the author of the bot. To get it fixed, it may be published in the ' +
          "project's public issue tracker without your name, username or contacts.",
      ],
    },
    {
      title: 'How long it is kept',
      paragraphs: [
        'Until you delete it. /delete removes your account and everything keyed to it at once. ' +
          '/stop only stops messages and deletes nothing.',
      ],
    },
  ],
};

const ru: PrivacyText = {
  title: 'Политика конфиденциальности',
  intro: 'Эта политика относится к Telegram-боту JobRadar @JobRadarAppBot.',
  openInTelegram: 'Открыть в Telegram',
  sections: [
    {
      title: 'Что хранит JobRadar',
      items: [
        'Твой Telegram user id, username и id чата.',
        'Язык интерфейса и твои настройки (доставка, фильтры, тихие часы, источники).',
        'Твоё резюме: файл PDF и извлечённый из него текст.',
        'Профиль кандидата, собранный по резюме.',
        'Отправленные тебе вакансии и твои реакции на них.',
        'Отклики, которые ты ведёшь в /applications.',
        'Если ты пересылаешь оповещения LinkedIn (/linkedin), JobRadar читает эти письма, чтобы достать из них вакансии.',
        'То, что ты пишешь в /feedback, пока автор это не разберёт.',
      ],
    },
    {
      title: 'Кто это видит',
      paragraphs: [
        'Только JobRadar. Ничего не продаётся и не передаётся.',
        'Чтобы прочитать резюме, его текст при каждой загрузке один раз отправляется AI-провайдеру: по умолчанию это Groq. ' +
          'Провайдеры, которые обучаются на присланных данных, твоё резюме не получают. Вакансии оцениваются формулой ' +
          'внутри JobRadar; для этого резюме AI-провайдеру не отправляется.',
        'То, что ты пишешь в /feedback, читает автор бота. Чтобы это исправить, текст может попасть в публичный список ' +
          'задач проекта без твоего имени, username и контактов.',
      ],
    },
    {
      title: 'Сколько хранится',
      paragraphs: [
        'Пока ты сам не удалишь. /delete сразу удаляет аккаунт и всё, что с ним связано. ' +
          '/stop только останавливает сообщения и ничего не удаляет.',
      ],
    },
  ],
};

export const PRIVACY_TEXT: Record<Language, PrivacyText> = { en, ru };
