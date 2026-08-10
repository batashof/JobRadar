import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  type Language,
  type TelegramLinkStart,
  type TelegramLinkStatus,
  TELEGRAM_LINK_TOKEN_TTL_MINUTES,
} from '@jobradar/shared';
import { and, eq, isNotNull } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { telegramAccounts, users } from '../db/schema';
import { parseUpdate, type TelegramUpdate } from './bot-update';
import { resolveLink } from './link-logic';
import { botMessage, DEFAULT_BOT_LANGUAGE } from './messages';
import {
  escapeHtml,
  type InlineKeyboard,
  type SendMessageOptions,
  TelegramApi,
  TelegramApiError,
} from './telegram-api';

/** What a feature's button handler receives when its callback fires. */
export interface BotCallbackContext {
  userId: string;
  chatId: string;
  messageId: number;
  /** `callback_data` split on ':' — `[namespace, action, ...rest]`. */
  parts: string[];
  language: Language;
}

/** What a handler asks the bot to do once it has processed the press. */
export interface BotCallbackResult {
  /** Toast shown on the button in the Telegram client. */
  alert?: string;
  /** Rewrites the message the button belongs to, e.g. to show the resolved state. */
  editText?: string;
  /** `null` strips the buttons; omit to leave the existing keyboard alone. */
  editKeyboard?: InlineKeyboard | null;
}

export type BotCallbackHandler = (ctx: BotCallbackContext) => Promise<BotCallbackResult | void>;

/**
 * The shared Telegram bot channel (ADR-015 §6): account linking, outbound
 * messages and button routing, used by the day planner today and by the daily
 * digest next.
 *
 * With no `TELEGRAM_BOT_TOKEN` every method degrades quietly — `isConfigured()`
 * is false, sends are skipped, and the features that use it stay in-app. That
 * is the same "optional integration" shape as Gmail and Sentry.
 *
 * Features register their own button handlers by namespace, so this module
 * never has to import them (which would make the dependency graph circular).
 */
@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);
  private readonly handlers = new Map<string, BotCallbackHandler>();
  private readonly api: TelegramApi | null;
  /** Resolved lazily from `getMe`, then cached — it never changes for a token. */
  private botUsername: string | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    config: ConfigService,
  ) {
    const token = config.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    this.api = token ? new TelegramApi(token) : null;
    if (!this.api) {
      this.logger.log('TELEGRAM_BOT_TOKEN is not set — the bot channel is off');
    }
  }

  isConfigured(): boolean {
    return this.api !== null;
  }

  /**
   * Registers a feature's button handler. `namespace` is the first segment of
   * `callback_data` (see `BOT_CALLBACK_NAMESPACES`); registering twice is a
   * programming error and throws rather than silently shadowing.
   */
  registerCallback(namespace: string, handler: BotCallbackHandler): void {
    if (this.handlers.has(namespace)) {
      throw new Error(`Bot callback namespace "${namespace}" is already registered`);
    }
    this.handlers.set(namespace, handler);
  }

  // -------------------------------------------------------------------------
  // Linking
  // -------------------------------------------------------------------------

  async linkStatus(userId: string): Promise<TelegramLinkStatus> {
    const [row] = await this.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, userId));

    return {
      botConfigured: this.isConfigured(),
      botUsername: await this.resolveBotUsername(),
      linked: Boolean(row?.chatId),
      chatId: row?.chatId ?? null,
      username: row?.username ?? null,
      linkedAt: row?.linkedAt?.toISOString() ?? null,
    };
  }

  /**
   * Issues a single-use deep link. Any previous pending token for the user is
   * replaced, so a link generated twice never leaves a second live token.
   */
  async startLink(userId: string): Promise<TelegramLinkStart> {
    const botUsername = await this.resolveBotUsername();
    if (!this.api || !botUsername) {
      throw new Error('Telegram bot is not configured');
    }

    // URL-safe by construction: the token travels in a `?start=` parameter.
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MINUTES * 60_000);

    await this.db
      .insert(telegramAccounts)
      .values({ userId, linkToken: token, linkTokenExpiresAt: expiresAt })
      .onConflictDoUpdate({
        target: telegramAccounts.userId,
        set: { linkToken: token, linkTokenExpiresAt: expiresAt, updatedAt: new Date() },
      });

    return {
      deepLink: `https://t.me/${botUsername}?start=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Drops the chat link. The row stays so a future link reuses the same key. */
  async unlink(userId: string): Promise<TelegramLinkStatus> {
    await this.db
      .update(telegramAccounts)
      .set({
        chatId: null,
        username: null,
        linkedAt: null,
        linkToken: null,
        linkTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(telegramAccounts.userId, userId));
    return this.linkStatus(userId);
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  /**
   * Sends to a user's linked chat. Returns the Telegram message id, or null
   * when the bot is off, the user is not linked, or Telegram rejected the send
   * — a failed nudge must never break the caller's transaction or its loop.
   */
  async sendToUser(
    userId: string,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<string | null> {
    if (!this.api) return null;

    const [row] = await this.db
      .select({ chatId: telegramAccounts.chatId })
      .from(telegramAccounts)
      .where(and(eq(telegramAccounts.userId, userId), isNotNull(telegramAccounts.chatId)));
    if (!row?.chatId) return null;

    try {
      const message = await this.api.sendMessage(row.chatId, text, options);
      return String(message.message_id);
    } catch (err) {
      // 403 means the user blocked the bot or deleted the chat: drop the link
      // rather than retrying it on every tick from now on.
      if (err instanceof TelegramApiError && err.errorCode === 403) {
        this.logger.warn(`chat ${row.chatId} rejected the bot — unlinking user ${userId}`);
        await this.unlink(userId);
        return null;
      }
      this.logger.warn(
        `send to user ${userId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Rewrites a previously sent message; best-effort, same failure policy as sends. */
  async editMessage(
    chatId: string,
    messageId: number,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.editMessageText(chatId, messageId, text, options);
    } catch (err) {
      this.logger.warn(
        `edit message ${messageId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  /**
   * Handles one webhook update. Always resolves: Telegram retries anything that
   * is not answered with 2xx, and a retry storm over a bad button is worse than
   * a dropped press.
   */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.api) return;
    const parsed = parseUpdate(update);
    if (!parsed) return;

    try {
      if (parsed.type === 'command') {
        await this.handleCommand(parsed.chatId, parsed.command, parsed.argument, parsed.username);
      } else {
        await this.handleCallback(parsed);
      }
    } catch (err) {
      this.logger.error(
        `update handling failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleCommand(
    chatId: string,
    command: string,
    argument: string,
    username: string | null,
  ): Promise<void> {
    switch (command) {
      case 'start':
        await this.completeLink(chatId, argument, username);
        return;
      case 'stop':
        await this.stopFromChat(chatId);
        return;
      case 'help':
        await this.replyToChat(chatId, 'help');
        return;
      default:
        await this.replyToChat(chatId, 'unknown');
    }
  }

  /** `/start <token>` — the second half of the deep link. */
  private async completeLink(
    chatId: string,
    token: string,
    username: string | null,
  ): Promise<void> {
    const now = new Date();
    const pending = token
      ? ((
          await this.db
            .select({
              userId: telegramAccounts.userId,
              linkTokenExpiresAt: telegramAccounts.linkTokenExpiresAt,
            })
            .from(telegramAccounts)
            .where(eq(telegramAccounts.linkToken, token))
        )[0] ?? null)
      : null;
    const owner = await this.accountByChat(chatId);

    const outcome = resolveLink({
      token,
      pending,
      chatOwnerUserId: owner?.userId ?? null,
      now,
    });

    switch (outcome.kind) {
      case 'greet':
        await this.replyToChat(chatId, outcome.alreadyLinked ? 'link.already' : 'start.plain');
        return;
      case 'expired':
        await this.replyToChat(chatId, 'link.expired');
        return;
      case 'taken':
        await this.replyToChat(chatId, 'link.taken');
        return;
      case 'link':
        await this.db
          .update(telegramAccounts)
          .set({
            chatId,
            username,
            linkedAt: now,
            linkToken: null,
            linkTokenExpiresAt: null,
            updatedAt: now,
          })
          .where(eq(telegramAccounts.userId, outcome.userId));
        await this.replyToChat(chatId, 'link.done', await this.languageOf(outcome.userId));
    }
  }

  private async stopFromChat(chatId: string): Promise<void> {
    const account = await this.accountByChat(chatId);
    if (!account) {
      await this.replyToChat(chatId, 'stop.notLinked');
      return;
    }
    const language = await this.languageOf(account.userId);
    await this.unlink(account.userId);
    await this.replyToChat(chatId, 'stop.done', language);
  }

  private async handleCallback(parsed: {
    callbackId: string;
    chatId: string;
    messageId: number;
    parts: string[];
  }): Promise<void> {
    const account = await this.accountByChat(parsed.chatId);
    const handler = this.handlers.get(parsed.parts[0] ?? '');
    const language = account ? await this.languageOf(account.userId) : DEFAULT_BOT_LANGUAGE;

    if (!account || !handler) {
      await this.api?.answerCallbackQuery(parsed.callbackId, botMessage(language, 'callback.stale'));
      return;
    }

    let result: BotCallbackResult | void;
    try {
      result = await handler({
        userId: account.userId,
        chatId: parsed.chatId,
        messageId: parsed.messageId,
        parts: parsed.parts,
        language,
      });
    } catch (err) {
      this.logger.warn(
        `callback ${parsed.parts.join(':')} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await this.api?.answerCallbackQuery(
        parsed.callbackId,
        botMessage(language, 'callback.failed'),
      );
      return;
    }

    // Answer first: the client spinner is waiting, and an edit may be slower.
    await this.api?.answerCallbackQuery(parsed.callbackId, result?.alert);
    if (result?.editText !== undefined) {
      await this.editMessage(parsed.chatId, parsed.messageId, result.editText, {
        parseMode: 'HTML',
        disablePreview: true,
        keyboard: result.editKeyboard ?? [],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async accountByChat(chatId: string) {
    const [row] = await this.db
      .select({ userId: telegramAccounts.userId })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.chatId, chatId));
    return row ?? null;
  }

  private async languageOf(userId: string): Promise<Language> {
    const [row] = await this.db
      .select({ language: users.language })
      .from(users)
      .where(eq(users.id, userId));
    return row?.language === 'en' ? 'en' : 'ru';
  }

  private async replyToChat(
    chatId: string,
    key: Parameters<typeof botMessage>[1],
    language: Language = DEFAULT_BOT_LANGUAGE,
  ): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.sendMessage(chatId, escapeHtml(botMessage(language, key)), {
        parseMode: 'HTML',
      });
    } catch (err) {
      this.logger.warn(
        `reply to chat ${chatId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** `getMe` once per process; a failure is not cached, so it retries later. */
  private async resolveBotUsername(): Promise<string | null> {
    if (!this.api) return null;
    if (this.botUsername) return this.botUsername;
    try {
      const me = await this.api.getMe();
      this.botUsername = me.username ?? null;
      return this.botUsername;
    } catch {
      return null;
    }
  }
}
