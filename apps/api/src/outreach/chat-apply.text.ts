import type { Language } from '@jobradar/shared';

import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';

/** Message text and keyboards for applying from inside the chat. Pure. */

const TEXT = {
  en: {
    preparing: 'Preparing the application…',
    draftTitle: 'Application for {title}',
    to: 'To',
    subject: 'Subject',
    send: 'Send',
    cancel: 'Cancel',
    cancelled: 'Cancelled — nothing was sent.',
    sent: 'Sent ✅ — moved to Applied on your board.',
    sendFailed: 'Could not send. Open it in the app to retry.',
    alreadySent: 'Already sent.',
    expired: 'This draft is gone. Press Apply again.',
    noGmail: 'Connect Gmail in the app to send applications from your own address.',
    telegramHint: 'Copy the text below and send it to {contact} — the resume is in the app.',
    openChat: 'Open the chat',
    linkHint: 'This one takes an application on the site. The letter is ready — copy it.',
    openApp: 'Open in the app',
    openPosting: 'Open the posting',
    noResume: 'Upload a resume first — it is attached to the email.',
    failed: 'Could not prepare the application. Try again from the app.',
  },
  ru: {
    preparing: 'Готовлю отклик…',
    draftTitle: 'Отклик на «{title}»',
    to: 'Кому',
    subject: 'Тема',
    send: 'Отправить',
    cancel: 'Отмена',
    cancelled: 'Отменено — ничего не отправлено.',
    sent: 'Отправлено ✅ — на доске переехало в «Откликнулся».',
    sendFailed: 'Не удалось отправить. Открой в приложении и попробуй ещё раз.',
    alreadySent: 'Уже отправлено.',
    expired: 'Черновик потерялся. Нажми «Откликнуться» ещё раз.',
    noGmail: 'Подключи Gmail в приложении, чтобы отправлять отклики со своего адреса.',
    telegramHint: 'Скопируй текст ниже и отправь {contact} — резюме лежит в приложении.',
    openChat: 'Открыть чат',
    linkHint: 'Тут отклик через сайт. Письмо готово — скопируй его.',
    openApp: 'Открыть в приложении',
    openPosting: 'Открыть вакансию',
    noResume: 'Сначала загрузи резюме — оно прикладывается к письму.',
    failed: 'Не удалось подготовить отклик. Попробуй из приложения.',
  },
} as const;

export type ApplyTextKey = keyof (typeof TEXT)['en'];

export function applyText(
  lang: Language,
  key: ApplyTextKey,
  vars: Record<string, string> = {},
): string {
  const template = TEXT[lang]?.[key] ?? TEXT.en[key];
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, value),
    template as string,
  );
}

/**
 * The email draft, exactly as it will be sent. `<pre>` keeps the body's line
 * breaks and makes it one tap to copy in the Telegram client.
 */
export function renderEmailDraft(
  lang: Language,
  draft: { recipient: string; subject: string; body: string },
  vacancyTitle: string,
): string {
  return [
    `<b>${escapeHtml(applyText(lang, 'draftTitle', { title: vacancyTitle }))}</b>`,
    '',
    `${applyText(lang, 'to')}: ${escapeHtml(draft.recipient)}`,
    `${applyText(lang, 'subject')}: ${escapeHtml(draft.subject)}`,
    '',
    `<pre>${escapeHtml(draft.body)}</pre>`,
  ].join('\n');
}

export function confirmKeyboard(lang: Language, draftId: string): InlineKeyboard {
  return [
    [
      { text: applyText(lang, 'send'), callbackData: `a:s:${draftId}` },
      { text: applyText(lang, 'cancel'), callbackData: `a:x:${draftId}` },
    ],
  ];
}

/** Ready-to-paste letter for the contact-is-a-Telegram-handle case. */
export function renderTelegramApply(
  lang: Language,
  contact: string,
  coverLetter: string,
): string {
  return [
    escapeHtml(applyText(lang, 'telegramHint', { contact })),
    '',
    `<pre>${escapeHtml(coverLetter)}</pre>`,
  ].join('\n');
}

/** Same, for a vacancy that only has a web form or no contact at all. */
export function renderLinkApply(lang: Language, coverLetter: string): string {
  return [
    escapeHtml(applyText(lang, 'linkHint')),
    '',
    `<pre>${escapeHtml(coverLetter)}</pre>`,
  ].join('\n');
}

/**
 * `t.me` link for a Telegram contact. Handles come out of scraped descriptions
 * as `@name`, a bare name or a full URL; anything that is not a plain handle
 * gets no button rather than a broken one.
 */
export function telegramContactUrl(value: string): string | null {
  const trimmed = value.trim();
  if (/^https?:\/\/(t\.me|telegram\.me)\//i.test(trimmed)) return trimmed;

  const handle = trimmed.replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(handle) ? `https://t.me/${handle}` : null;
}
