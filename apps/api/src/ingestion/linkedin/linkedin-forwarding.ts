import { randomBytes } from 'node:crypto';
import type { Language } from '@jobradar/shared';

import { escapeHtml } from '../../bot/telegram-api';

/**
 * Personal forwarding addresses for LinkedIn job alerts (ADR-027).
 *
 * Every bot user gets `<local>+<token>@<domain>` on the one dedicated alerts
 * mailbox (`ALERTS_IMAP_USER`). Gmail and most providers deliver plus-addressed
 * mail to the base mailbox and keep the full address in Delivered-To / To, so
 * the token in the recipient tells whose alert a message is.
 */

/** Sender of Gmail's "confirm this forwarding address" emails. */
export const GMAIL_FORWARDING_SENDER = 'forwarding-noreply@google.com';

/** Sender LinkedIn's alerts come from; the filter users create matches on it. */
export const LINKEDIN_ALERT_SENDER = 'jobalerts-noreply@linkedin.com';

export const ALERTS_TOKEN_LENGTH = 12;

/** RFC 4648 base32 alphabet, lowercased: unambiguous in an email address. */
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** 12 random base32 characters: 60 bits, unguessable for this purpose. */
export function generateAlertsToken(): string {
  const bytes = randomBytes(ALERTS_TOKEN_LENGTH);
  let token = '';
  for (const byte of bytes) token += TOKEN_ALPHABET[byte & 31];
  return token;
}

function splitAddress(address: string): { local: string; domain: string } | null {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  return { local: trimmed.slice(0, at), domain: trimmed.slice(at + 1) };
}

/** `alerts@gmail.com` + `abc` → `alerts+abc@gmail.com`; null for a malformed mailbox. */
export function buildForwardingAddress(mailboxUser: string, token: string): string | null {
  const parts = splitAddress(mailboxUser);
  if (!parts) return null;
  // A mailbox configured with a plus tag of its own keeps only the base local part.
  const base = parts.local.split('+')[0] ?? parts.local;
  return `${base}+${token.toLowerCase()}@${parts.domain}`;
}

/**
 * The token from the first recipient that is a plus address of the alerts
 * mailbox, compared case-insensitively. Null when the message was sent to the
 * bare mailbox (the owner's own alerts) or to somewhere else entirely.
 */
export function extractAlertsToken(recipients: string[], mailboxUser: string): string | null {
  const mailbox = splitAddress(mailboxUser);
  if (!mailbox) return null;
  const base = mailbox.local.split('+')[0] ?? mailbox.local;
  // Gmail ignores dots in the local part: alerts+x and a.lerts+x reach the same box.
  const gmail = mailbox.domain === 'gmail.com' || mailbox.domain === 'googlemail.com';
  const normalize = (local: string) => (gmail ? local.replace(/\./g, '') : local);

  for (const recipient of recipients) {
    const parts = splitAddress(recipient);
    if (!parts || parts.domain !== mailbox.domain) continue;
    const plus = parts.local.indexOf('+');
    if (plus <= 0) continue;
    if (normalize(parts.local.slice(0, plus)) !== normalize(base)) continue;
    const token = parts.local.slice(plus + 1);
    if (/^[a-z0-9]{1,64}$/.test(token)) return token;
  }
  return null;
}

export interface ForwardingConfirmationCandidate {
  from: string;
  subject: string;
  text: string;
  html: string;
}

/** Whether a message is Gmail asking to confirm a forwarding address. */
export function isForwardingConfirmation(
  message: Pick<ForwardingConfirmationCandidate, 'from' | 'subject'>,
): boolean {
  return (
    message.from.toLowerCase() === GMAIL_FORWARDING_SENDER ||
    /Gmail Forwarding Confirmation/i.test(message.subject) ||
    /Подтверждение пересылки/i.test(message.subject)
  );
}

export interface ForwardingConfirmation {
  code: string;
  link: string | null;
}

/**
 * The confirmation code (from the subject's "(#123456789)" or the body) and
 * the confirmation link, if the email carries one. Null without a code.
 */
export function parseForwardingConfirmation(
  message: ForwardingConfirmationCandidate,
): ForwardingConfirmation | null {
  const body = `${message.text}\n${message.html}`;
  const code =
    /\(#(\d{6,12})\)/.exec(message.subject)?.[1] ??
    /(?:code|код)[^\d\n]{0,40}(\d{6,12})(?!\d)/i.exec(body)?.[1] ??
    /(?<!\d)(\d{6,12})(?!\d)/.exec(message.subject)?.[1] ??
    null;
  if (!code) return null;
  return { code, link: findConfirmationLink(body) };
}

function findConfirmationLink(body: string): string | null {
  for (const match of body.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    const raw = match[0].replace(/&amp;/g, '&').replace(/[).,;]+$/, '');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if ((host === 'google.com' || host.endsWith('.google.com')) && url.href.includes('vf')) {
      return url.href;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bot texts
// ---------------------------------------------------------------------------

/** The message relaying Gmail's confirmation code to the user. */
export function confirmationText(language: Language, confirmation: ForwardingConfirmation): string {
  const code = `<code>${escapeHtml(confirmation.code)}</code>`;
  const link = confirmation.link
    ? `<a href="${escapeHtml(confirmation.link)}">${language === 'ru' ? 'Подтвердить по ссылке' : 'Confirm by link'}</a>`
    : null;
  if (language === 'ru') {
    return [
      'Gmail прислал код подтверждения пересылки на твой адрес для вакансий LinkedIn:',
      '',
      code,
      '',
      'Вставь его в Gmail: Настройки → Пересылка и POP/IMAP → поле кода подтверждения → «Подтвердить».',
      ...(link ? ['', `Или открой ссылку: ${link}`] : []),
    ].join('\n');
  }
  return [
    'Gmail sent a forwarding confirmation code to your LinkedIn-alerts address:',
    '',
    code,
    '',
    'Paste it in Gmail: Settings → Forwarding and POP/IMAP → the confirmation code field → Verify.',
    ...(link ? ['', `Or open the link: ${link}`] : []),
  ].join('\n');
}

/** The `/linkedin` reply: the personal address and how to set forwarding up. */
export function instructionsText(language: Language, address: string, recentCount: number): string {
  const addr = `<code>${escapeHtml(address)}</code>`;
  const sender = `<code>from:${LINKEDIN_ALERT_SENDER}</code>`;
  if (language === 'ru') {
    return [
      '<b>Вакансии из твоих LinkedIn-оповещений</b>',
      '',
      `Твой личный адрес для пересылки: ${addr}`,
      '',
      '1. На LinkedIn создай оповещения о вакансиях (Job alerts) с уведомлениями на почту.',
      '2. В Gmail: Настройки → Пересылка и POP/IMAP → Добавить адрес пересылки → этот адрес. Код подтверждения я пришлю сюда в течение ~10 минут.',
      `3. Создай фильтр ${sender} → «Переслать на» этот адрес.`,
      '4. Другая почта: настрой перенаправление (redirect), которое сохраняет исходного отправителя.',
      '',
      'Вакансии из твоих оповещений видишь только ты.',
      `За последние 14 дней из твоих оповещений пришло вакансий: ${recentCount}.`,
    ].join('\n');
  }
  return [
    '<b>Vacancies from your LinkedIn job alerts</b>',
    '',
    `Your personal forwarding address: ${addr}`,
    '',
    '1. On LinkedIn, create job alerts with email notifications.',
    '2. In Gmail: Settings → Forwarding and POP/IMAP → Add a forwarding address → this address. I will send the confirmation code here within ~10 minutes.',
    `3. Create a filter ${sender} → Forward it to this address.`,
    '4. Other mail services: use a redirect/forward rule that keeps the original sender.',
    '',
    'Vacancies from your alerts are shown only to you.',
    `Vacancies from your alerts in the last 14 days: ${recentCount}.`,
  ].join('\n');
}

export function unavailableText(language: Language): string {
  return language === 'ru'
    ? 'Пересылка оповещений LinkedIn сейчас недоступна. Попробуй позже.'
    : 'LinkedIn alert forwarding is unavailable right now. Try again later.';
}
