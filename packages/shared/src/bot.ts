/**
 * Telegram bot channel — the shared outbound/inbound surface used by the day
 * planner's nudges (ADR-015 §6) and, next, the daily vacancy digest.
 *
 * This is the **Bot API** side: a bot token, outbound `sendMessage`, and a
 * webhook for replies. It is deliberately separate from the MTProto ingestion
 * client of ADR-009 — different credentials, opposite direction, and the two
 * must never be confused (`TELEGRAM_BOT_TOKEN` vs `TELEGRAM_API_ID`/`_HASH`).
 *
 * One chat link per user, stored once and shared by every feature that wants
 * to reach the phone; per-feature opt-in stays with the feature (the planner
 * keeps its own `telegramEnabled` toggle).
 */

/** Whether the account is linked to a Telegram chat, and to which one. */
export interface TelegramLinkStatus {
  /** False when `TELEGRAM_BOT_TOKEN` is unset — the whole channel is off. */
  botConfigured: boolean;
  /** `@name` of the bot, resolved from the token; null when unconfigured. */
  botUsername: string | null;
  linked: boolean;
  /** Telegram chat id the bot writes to; null until `/start` completes. */
  chatId: string | null;
  /** Telegram @username of the linked account, when it has one. */
  username: string | null;
  linkedAt: string | null;
}

/** Deep link that completes the link when opened in Telegram. */
export interface TelegramLinkStart {
  /** `https://t.me/<bot>?start=<token>` — open on any device, one tap. */
  deepLink: string;
  expiresAt: string;
}

/** Minutes a pending link token stays valid. Short: it is used immediately. */
export const TELEGRAM_LINK_TOKEN_TTL_MINUTES = 15;

/**
 * Callback-data namespaces. Telegram caps `callback_data` at 64 bytes, so the
 * wire format is `<ns>:<action>:<id>` with two-letter namespaces — a UUID plus
 * a namespace and action still fits with room to spare.
 */
export const BOT_CALLBACK_NAMESPACES = {
  /** Day-planner nudges (ack, block actions). */
  nudge: 'n',
  /** Daily vacancy digest (hide, feedback). */
  digest: 'd',
  /**
   * Applying from inside the chat (draft, send, cancel). Its own namespace
   * rather than the digest's: the flow belongs to outreach, and any future
   * surface that offers "apply" reuses the same handler.
   */
  apply: 'a',
} as const;
