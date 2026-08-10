/**
 * The decision half of `/start` handling, kept pure so the rules are testable
 * without a database or a bot token — same split as `planner/tick-logic.ts`.
 */

export type LinkOutcome =
  /** `/start` with no token: either a greeting or "already linked". */
  | { kind: 'greet'; alreadyLinked: boolean }
  /** Token unknown or past its TTL — both point at "generate a new one". */
  | { kind: 'expired' }
  /** The chat already drives a different account; refuse rather than steal it. */
  | { kind: 'taken' }
  | { kind: 'link'; userId: string };

export interface LinkInput {
  /** Argument of `/start`; empty when the command was typed by hand. */
  token: string;
  /** Row matching the token, if any. */
  pending: { userId: string; linkTokenExpiresAt: Date | null } | null;
  /** Account this chat is currently linked to, if any. */
  chatOwnerUserId: string | null;
  now: Date;
}

export function resolveLink(input: LinkInput): LinkOutcome {
  if (!input.token) {
    return { kind: 'greet', alreadyLinked: input.chatOwnerUserId !== null };
  }
  const expiresAt = input.pending?.linkTokenExpiresAt;
  if (!input.pending || !expiresAt || expiresAt.getTime() <= input.now.getTime()) {
    return { kind: 'expired' };
  }
  if (input.chatOwnerUserId !== null && input.chatOwnerUserId !== input.pending.userId) {
    return { kind: 'taken' };
  }
  // Re-linking the same chat to the same account is allowed: it refreshes the
  // stored username and is what a user does after reinstalling Telegram.
  return { kind: 'link', userId: input.pending.userId };
}
