/**
 * The decision half of `/start` handling, kept pure so the rules are testable
 * without a database or a bot token — same split as `planner/tick-logic.ts`.
 *
 * Two entry points share it (ADR-024): `/start <token>` links the author's web
 * account to the chat, and a plain `/start` from someone the bot has never seen
 * creates a new account right there.
 */

export type LinkOutcome =
  /** `/start` with no token in a chat that already drives an account. */
  | { kind: 'greet' }
  /** `/start` with no token from a known Telegram user whose chat was unlinked (`/stop`). */
  | { kind: 'relink'; userId: string }
  /** `/start` with no token from a Telegram user the bot has never seen. */
  | { kind: 'register' }
  /** Token unknown or past its TTL — both point at "generate a new one". */
  | { kind: 'expired' }
  /** The chat (or the Telegram user) already drives a different account; refuse rather than steal it. */
  | { kind: 'taken' }
  | { kind: 'link'; userId: string };

export interface LinkInput {
  /** Argument of `/start`; empty when the command was typed by hand. */
  token: string;
  /** Row matching the token, if any. */
  pending: { userId: string; linkTokenExpiresAt: Date | null } | null;
  /** Account this chat is currently linked to, if any. */
  chatOwnerUserId: string | null;
  /** Account whose `users.telegram_user_id` is the sender, if any. */
  telegramUserOwnerId: string | null;
  now: Date;
}

export function resolveLink(input: LinkInput): LinkOutcome {
  if (!input.token) {
    if (input.chatOwnerUserId !== null) return { kind: 'greet' };
    if (input.telegramUserOwnerId !== null) {
      return { kind: 'relink', userId: input.telegramUserOwnerId };
    }
    return { kind: 'register' };
  }
  const expiresAt = input.pending?.linkTokenExpiresAt;
  if (!input.pending || !expiresAt || expiresAt.getTime() <= input.now.getTime()) {
    return { kind: 'expired' };
  }
  const target = input.pending.userId;
  if (input.chatOwnerUserId !== null && input.chatOwnerUserId !== target) {
    return { kind: 'taken' };
  }
  // A Telegram user who already has a bot-made account cannot also attach a
  // web account: `telegram_user_id` is unique, one person, one account.
  if (input.telegramUserOwnerId !== null && input.telegramUserOwnerId !== target) {
    return { kind: 'taken' };
  }
  // Re-linking the same chat to the same account is allowed: it refreshes the
  // stored username and is what a user does after reinstalling Telegram.
  return { kind: 'link', userId: target };
}

/**
 * Longest `/start` argument read as a source tag (v2.6.0). The web link
 * tokens are 32 characters (24 random bytes, base64url), so a tag can never be
 * mistaken for one.
 */
export const START_SOURCE_MAX = 30;

/**
 * The tag of a shared link such as `t.me/<bot>?start=dou_chat`: which chat,
 * post or friend brought a new user, for the owner's /stats. Telegram allows
 * `A-Z a-z 0-9 _ -` in a start parameter; anything else, or anything as long
 * as a link token, is not a tag.
 */
export function startSource(argument: string): string | null {
  if (argument.length === 0 || argument.length > START_SOURCE_MAX) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(argument)) return null;
  return argument.toLowerCase();
}

/** Languages whose speakers get the Russian interface; everyone else gets English (ADR-014). */
const RUSSIAN_INTERFACE = new Set(['ru', 'be', 'kk', 'ky', 'uz', 'tg']);

/**
 * Interface language for a new account from the Telegram client's
 * `language_code` (an IETF tag such as `ru`, `en-US`). Unknown → Russian, the
 * first audience (ADR-024).
 */
export function languageFromTelegram(code: string | null | undefined): 'ru' | 'en' {
  if (!code) return 'ru';
  const base = code.toLowerCase().split('-')[0] ?? '';
  return RUSSIAN_INTERFACE.has(base) ? 'ru' : 'en';
}
