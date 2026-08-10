/**
 * Pure parsing of an incoming Telegram update into the two shapes the bot
 * actually reacts to: a slash command and a button press. Everything else
 * (edited messages, channel posts, stickers) is deliberately ignored — the
 * bot is a delivery channel, not a chat partner.
 *
 * Kept free of IO so the routing rules are unit-testable without a token.
 */

/** Raw update, narrowed to the fields we read. Telegram sends far more. */
export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string; type?: string };
    from?: { username?: string; is_bot?: boolean };
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { message_id?: number; chat?: { id?: number | string } };
    from?: { username?: string };
  };
}

export interface ParsedCommand {
  type: 'command';
  chatId: string;
  username: string | null;
  /** Lower-cased, without the leading slash and without any `@botname` suffix. */
  command: string;
  /** Everything after the command, trimmed; empty string when absent. */
  argument: string;
}

export interface ParsedCallback {
  type: 'callback';
  callbackId: string;
  chatId: string;
  messageId: number;
  /** Raw `callback_data`, e.g. `n:a:<uuid>`. */
  data: string;
  /** `data` split on ':' — `[namespace, action, ...rest]`. */
  parts: string[];
}

export type ParsedUpdate = ParsedCommand | ParsedCallback | null;

export function parseUpdate(update: TelegramUpdate): ParsedUpdate {
  const callback = update.callback_query;
  if (callback?.id && callback.data) {
    const chatId = callback.message?.chat?.id;
    const messageId = callback.message?.message_id;
    // A callback whose originating message is gone cannot be answered usefully.
    if (chatId === undefined || messageId === undefined) return null;
    return {
      type: 'callback',
      callbackId: callback.id,
      chatId: String(chatId),
      messageId,
      data: callback.data,
      parts: callback.data.split(':'),
    };
  }

  const message = update.message;
  const text = message?.text?.trim();
  const chatId = message?.chat?.id;
  // Only private chats: a link is per-account, and group delivery is not a goal.
  if (!text || chatId === undefined || message?.chat?.type !== 'private') return null;
  if (!text.startsWith('/')) return null;

  const [head = '', ...rest] = text.split(/\s+/);
  // Telegram appends `@botname` when a command is typed in a chat with several bots.
  const command = (head.slice(1).split('@')[0] ?? '').toLowerCase();
  if (!command) return null;

  return {
    type: 'command',
    chatId: String(chatId),
    username: message.from?.username ?? null,
    command,
    argument: rest.join(' ').trim(),
  };
}
