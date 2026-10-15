/**
 * Pure parsing of an incoming Telegram update into the shapes the bot reacts
 * to: a slash command, a button press, plain text (an answer to an open
 * dialog) and a document (a resume). Everything else (edited messages, channel
 * posts, stickers) is deliberately ignored.
 *
 * Kept free of IO so the routing rules are unit-testable without a token.
 */

/** Raw update, narrowed to the fields we read. Telegram sends far more. */
export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    document?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
    chat?: { id?: number | string; type?: string };
    from?: { id?: number | string; username?: string; is_bot?: boolean; language_code?: string };
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
  /** Telegram user id of the sender (`from.id`); null if Telegram omitted it. */
  fromId: string | null;
  /** IETF language tag of the sender's client, e.g. `ru` or `en-US`. */
  languageCode: string | null;
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

/** Plain text that is not a command: an answer to an open dialog, if any. */
export interface ParsedText {
  type: 'text';
  chatId: string;
  fromId: string | null;
  languageCode: string | null;
  text: string;
}

/** A file sent to the bot, e.g. a resume PDF (ADR-025). */
export interface ParsedDocument {
  type: 'document';
  chatId: string;
  fromId: string | null;
  languageCode: string | null;
  fileId: string;
  fileName: string;
  mimeType: string | null;
  /** Bytes as Telegram reports them; null when omitted. */
  fileSize: number | null;
}

export type ParsedUpdate = ParsedCommand | ParsedCallback | ParsedText | ParsedDocument | null;

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
  if (chatId === undefined || message?.chat?.type !== 'private') return null;
  const sender = {
    chatId: String(chatId),
    fromId: message.from?.id !== undefined ? String(message.from.id) : null,
    languageCode: message.from?.language_code ?? null,
  };

  const document = message.document;
  if (document?.file_id) {
    return {
      type: 'document',
      ...sender,
      fileId: document.file_id,
      fileName: document.file_name ?? 'resume.pdf',
      mimeType: document.mime_type ?? null,
      fileSize: document.file_size ?? null,
    };
  }

  if (!text) return null;
  if (!text.startsWith('/')) return { type: 'text', ...sender, text };

  const [head = '', ...rest] = text.split(/\s+/);
  // Telegram appends `@botname` when a command is typed in a chat with several bots.
  const command = (head.slice(1).split('@')[0] ?? '').toLowerCase();
  if (!command) return null;

  return {
    type: 'command',
    ...sender,
    username: message.from?.username ?? null,
    command,
    argument: rest.join(' ').trim(),
  };
}
