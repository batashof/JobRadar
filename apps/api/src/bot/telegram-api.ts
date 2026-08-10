import { Logger } from '@nestjs/common';

/**
 * Minimal Telegram Bot API client. Hand-rolled on `fetch` rather than pulling
 * in a bot framework: we need four methods, and ADR-001 keeps the dependency
 * budget tight. The MTProto ingestion client (ADR-009) is a different thing
 * entirely — different credentials, different direction.
 */

const API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 10_000;

/** One row of an inline keyboard; a keyboard is rows of buttons. */
export interface InlineButton {
  text: string;
  /** Mutually exclusive with `url`; capped at 64 bytes by Telegram. */
  callbackData?: string;
  url?: string;
}
export type InlineKeyboard = InlineButton[][];

export interface SendMessageOptions {
  keyboard?: InlineKeyboard;
  /** Telegram's own light markup. Text must be escaped by the caller. */
  parseMode?: 'HTML';
  disablePreview?: boolean;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

/** Raised for a non-ok Bot API reply so callers can distinguish it from a network fault. */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number | undefined,
    description: string,
    /** Seconds Telegram asked us to wait; set only on 429. */
    readonly retryAfter?: number,
  ) {
    super(`${method} failed: ${description}`);
    this.name = 'TelegramApiError';
  }
}

/** Escapes the four characters Telegram's HTML parse mode treats as markup. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export class TelegramApi {
  private readonly logger = new Logger(TelegramApi.name);

  constructor(private readonly token: string) {}

  async sendMessage(
    chatId: string,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode,
      link_preview_options: options.disablePreview ? { is_disabled: true } : undefined,
      reply_markup: options.keyboard ? { inline_keyboard: toWire(options.keyboard) } : undefined,
    });
  }

  /**
   * Every callback query must be answered, or the client shows a spinner until
   * it times out. `text` surfaces as a toast on the button.
   */
  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, text });
  }

  /** Used to rewrite a nudge/digest card once its buttons have been used. */
  async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parseMode,
      link_preview_options: options.disablePreview ? { is_disabled: true } : undefined,
      reply_markup: options.keyboard ? { inline_keyboard: toWire(options.keyboard) } : undefined,
    });
  }

  async getMe(): Promise<{ id: number; username?: string }> {
    return this.call<{ id: number; username?: string }>('getMe', {});
  }

  /**
   * Registers the webhook. The secret token rides in a header on every update,
   * which is what makes the public endpoint safe to expose.
   */
  async setWebhook(url: string, secretToken: string): Promise<void> {
    await this.call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
    });
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Undefined values would serialise as absent keys anyway; JSON.stringify drops them.
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(
        `${method} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const payload = (await response.json().catch(() => ({ ok: false }))) as TelegramResponse<T>;
    if (!payload.ok || payload.result === undefined) {
      const error = new TelegramApiError(
        method,
        payload.error_code,
        payload.description ?? `HTTP ${response.status}`,
        payload.parameters?.retry_after,
      );
      // Never log the token — it is only ever in the URL, which we do not print.
      this.logger.warn(error.message);
      throw error;
    }
    return payload.result;
  }
}

function toWire(keyboard: InlineKeyboard) {
  return keyboard.map((row) =>
    row.map((button) => ({
      text: button.text,
      callback_data: button.callbackData,
      url: button.url,
    })),
  );
}
