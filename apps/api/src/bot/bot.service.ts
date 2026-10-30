import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  BOT_CALLBACK_NAMESPACES,
  isOwnerRole,
  type Language,
  type TelegramLinkStart,
  type TelegramLinkStatus,
  TELEGRAM_LINK_TOKEN_TTL_MINUTES,
  type UserRole,
} from '@jobradar/shared';
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';

import { recordEvent } from '../common/events';
import { recordErrorReport } from '../triage/reports';
import { isTransientError } from '../triage/triage-logic';
import { DB, type Database } from '../db/db.module';
import { digestSettings, plannerSettings, telegramAccounts, users } from '../db/schema';
import { BotDialogs, type OpenDialog } from './bot-dialogs';
import { menuCommands, OWNER_COMMANDS, PUBLIC_COMMANDS } from './command-menu';
import {
  describeUpdate,
  type ParsedCommand,
  type ParsedDocument,
  type ParsedText,
  parseUpdate,
  type TelegramUpdate,
} from './bot-update';
import { languageFromTelegram, resolveLink, startSource } from './link-logic';
import { SendLimiter } from './send-limiter';
import { botMessage, DEFAULT_BOT_LANGUAGE } from './messages';
import {
  escapeHtml,
  type InlineKeyboard,
  type SendMessageOptions,
  TelegramApi,
  TelegramApiError,
} from './telegram-api';

/**
 * Longest wait honoured on a 429 before the one retry. Telegram's private-chat
 * flood waits are seconds; anything longer means the chat is being throttled
 * hard, and the run moves on rather than holding every other user.
 */
const FLOOD_RETRY_MAX_SECONDS = 30;

/**
 * The same error (place and message) reaches the owner's chat once per window
 * (v2.6.0); repeats inside it are logged and counted in `events` only, so a
 * broken button pressed by twenty users is one alert, not twenty.
 */
export const ERROR_ALERT_WINDOW_MS = 30 * 60_000;

/** `users.last_seen_at` is rewritten at most this often per user (v2.6.0). */
export const LAST_SEEN_STEP_MS = 60 * 60_000;

/**
 * A starting timezone for a new account; Telegram does not tell the bot the
 * user's. The Russian-speaking audience is mostly UTC+3 (Minsk, Moscow), and
 * /settings changes it in two taps.
 */
export function defaultTimezone(language: Language): string {
  return language === 'ru' ? 'Europe/Moscow' : 'UTC';
}

/** What a feature's button handler receives when its callback fires. */
export interface BotCallbackContext {
  userId: string;
  chatId: string;
  messageId: number;
  /** `callback_data` split on ':' — `[namespace, action, ...rest]`. */
  parts: string[];
  language: Language;
  /** ADR-024 §3: handlers of LLM-per-action features refuse non-owners. */
  role: UserRole;
}

/** What a handler asks the bot to do once it has processed the press. */
export interface BotCallbackResult {
  /** Toast shown on the button in the Telegram client. */
  alert?: string;
  /** Rewrites the message the button belongs to, e.g. to show the resolved state. */
  editText?: string;
  /**
   * `null` strips the buttons; omit to leave the existing keyboard alone. Given
   * without `editText`, only the buttons change and the text stays as sent.
   */
  editKeyboard?: InlineKeyboard | null;
}

export type BotCallbackHandler = (ctx: BotCallbackContext) => Promise<BotCallbackResult | void>;

/** The account behind an incoming message. */
export interface BotMessageContext {
  userId: string;
  chatId: string;
  language: Language;
  role: UserRole;
}

/** A file the user sent; the handler downloads it with `BotService.downloadFile`. */
export type BotDocumentHandler = (
  ctx: BotMessageContext,
  document: Pick<ParsedDocument, 'fileId' | 'fileName' | 'mimeType' | 'fileSize'>,
) => Promise<void>;

/** Typed text that answers the open dialog of the handler's flow. */
export type BotDialogHandler = (
  ctx: BotMessageContext,
  text: string,
  dialog: OpenDialog,
) => Promise<void>;

/** A slash command owned by a feature module, for an account that exists. */
export type BotCommandHandler = (ctx: BotMessageContext, argument: string) => Promise<void>;

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
export class BotService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BotService.name);
  private readonly handlers = new Map<string, BotCallbackHandler>();
  private readonly dialogHandlers = new Map<string, BotDialogHandler>();
  private readonly commandHandlers = new Map<string, BotCommandHandler>();
  private documentHandler: BotDocumentHandler | null = null;
  private readonly api: TelegramApi | null;
  /** Paces pushes to Telegram's broadcast limits (roadmap 5.3). */
  private readonly limiter = new SendLimiter();
  /** Resolved lazily from `getMe`, then cached — it never changes for a token. */
  private botUsername: string | null = null;
  /** When each error was last sent to the owner: `where|message` → epoch ms. */
  private readonly errorAlerts = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Database,
    config: ConfigService,
    private readonly dialogs: BotDialogs,
  ) {
    const token = config.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    this.api = token ? new TelegramApi(token) : null;
    if (!this.api) {
      this.logger.log('TELEGRAM_BOT_TOKEN is not set — the bot channel is off');
    }
    // The account namespace is the bot's own; features register theirs on init.
    this.handlers.set(BOT_CALLBACK_NAMESPACES.account, (ctx) => this.handleAccountCallback(ctx));
  }

  isConfigured(): boolean {
    return this.api !== null;
  }

  /** Every module has registered its commands by now, so the menu can go out. */
  onApplicationBootstrap(): void {
    // Not awaited: a slow or failing Telegram call must not hold up startup.
    void this.publishMenu().catch((err: unknown) => {
      this.logger.warn(`command menu not published: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * Telegram's menu button (roadmap 5.7): the public commands per language,
   * plus the author tools in each owner chat. Idempotent, so every deploy
   * simply sets it again.
   */
  async publishMenu(): Promise<void> {
    if (!this.api) return;
    const listed = new Set([...PUBLIC_COMMANDS, ...OWNER_COMMANDS].map(([command]) => command));
    const missing = [...this.commandHandlers.keys()].filter((command) => !listed.has(command));
    if (missing.length > 0) {
      this.logger.warn(`commands missing from the menu: ${missing.map((c) => `/${c}`).join(', ')}`);
    }

    await this.api.setMyCommands(menuCommands('en'));
    await this.api.setMyCommands(menuCommands('ru'), { languageCode: 'ru' });

    const owners = await this.db
      .select({ chatId: telegramAccounts.chatId, language: users.language })
      .from(telegramAccounts)
      .innerJoin(users, eq(users.id, telegramAccounts.userId))
      .where(and(eq(users.role, 'owner'), isNotNull(telegramAccounts.chatId)));
    for (const owner of owners) {
      if (!owner.chatId) continue;
      const lang = owner.language === 'ru' ? 'ru' : 'en';
      await this.api.setMyCommands(menuCommands(lang, true), { chatId: owner.chatId });
    }
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

  /** Registers the one handler for files sent to the bot (the resume flow). */
  /** A feature's own slash command, e.g. `/settings`. The bot's own commands win. */
  registerCommand(command: string, handler: BotCommandHandler): void {
    if (this.commandHandlers.has(command)) {
      throw new Error(`bot command /${command} is already registered`);
    }
    this.commandHandlers.set(command, handler);
  }

  registerDocumentHandler(handler: BotDocumentHandler): void {
    if (this.documentHandler) throw new Error('A bot document handler is already registered');
    this.documentHandler = handler;
  }

  /** Registers the handler that receives typed answers to dialogs of `flow`. */
  registerDialog(flow: string, handler: BotDialogHandler): void {
    if (this.dialogHandlers.has(flow)) {
      throw new Error(`Bot dialog flow "${flow}" is already registered`);
    }
    this.dialogHandlers.set(flow, handler);
  }

  /** Bytes of a file a user sent. Throws when the bot is off or the file is too big. */
  async downloadFile(fileId: string, maxBytes: number): Promise<Buffer> {
    if (!this.api) throw new Error('Telegram bot is not configured');
    return this.api.downloadFile(fileId, maxBytes);
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
      const message = await this.sendWithFloodRetry(this.api, row.chatId, text, options);
      return String(message.message_id);
    } catch (err) {
      // 403 means the user blocked the bot or deleted the chat: drop the link
      // rather than retrying it on every tick from now on.
      if (err instanceof TelegramApiError && err.errorCode === 403) {
        // Unlinking is what turns the digest off: every run joins on a linked
        // chat, and a later /start relinks and resumes it with settings intact.
        this.logger.warn(`chat ${row.chatId} rejected the bot — unlinking user ${userId}`);
        await this.unlink(userId);
        await recordEvent(this.db, userId, 'bot_blocked');
        return null;
      }
      this.logger.warn(
        `send to user ${userId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * One send, retried once when Telegram answers 429. A digest with every new
   * vacancy (ADR-022) is dozens of messages in a row, past the ~1 message per
   * second a chat is allowed, and the caller records a vacancy as delivered
   * whether or not the send landed — so a flood-limited card would be lost for
   * good. The wait is Telegram's own `retry_after`, bounded so one chat can
   * never stall the whole run.
   */
  private async sendWithFloodRetry(
    api: TelegramApi,
    chatId: string,
    text: string,
    options: SendMessageOptions,
  ): Promise<{ message_id: number }> {
    await this.limiter.acquire(chatId);
    try {
      return await api.sendMessage(chatId, text, options);
    } catch (err) {
      if (!(err instanceof TelegramApiError) || err.errorCode !== 429) throw err;
      const seconds = Math.min(err.retryAfter ?? 1, FLOOD_RETRY_MAX_SECONDS);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return api.sendMessage(chatId, text, options);
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
      await this.touchLastSeen(parsed.chatId);
      if (parsed.type === 'command') {
        await this.handleCommand(parsed);
      } else if (parsed.type === 'callback') {
        await this.handleCallback(parsed);
      } else if (parsed.type === 'text') {
        await this.handleText(parsed);
      } else {
        await this.handleDocument(parsed);
      }
    } catch (err) {
      const account = await this.accountByChat(parsed.chatId).catch(() => null);
      await this.reportError(describeUpdate(parsed), err, account?.userId ?? null);
    }
  }

  /**
   * Marks the sender as seen for the owner's /stats (v2.6.0). In a private chat
   * the chat id is the sender's Telegram user id, so one keyed UPDATE does it,
   * and the time condition keeps it to one write an hour per user.
   */
  private async touchLastSeen(chatId: string, now: Date = new Date()): Promise<void> {
    try {
      const stale = new Date(now.getTime() - LAST_SEEN_STEP_MS);
      await this.db
        .update(users)
        .set({ lastSeenAt: now })
        .where(
          and(
            eq(users.telegramUserId, chatId),
            or(isNull(users.lastSeenAt), lt(users.lastSeenAt, stale)),
          ),
        );
    } catch (err) {
      this.logger.warn(`last seen not saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Sends plain text to every owner's chat (v2.6.0): error alerts and user
   * feedback. `render` gets each owner's language. Best-effort, never throws.
   */
  async notifyOwners(render: (language: Language) => string): Promise<void> {
    if (!this.api) return;
    try {
      const owners = await this.db
        .select({ chatId: telegramAccounts.chatId, language: users.language })
        .from(users)
        .innerJoin(telegramAccounts, eq(telegramAccounts.userId, users.id))
        .where(and(eq(users.role, 'owner'), isNotNull(telegramAccounts.chatId)));
      for (const owner of owners) {
        if (!owner.chatId) continue;
        await this.replyTextToChat(owner.chatId, render(owner.language === 'en' ? 'en' : 'ru'));
      }
    } catch (err) {
      this.logger.warn(`owner notice not sent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * A failure a user ran into (v2.6.0): logged, counted as an `error` event for
   * /stats and in the triage inbox (ADR-036), and sent to the owner's chat once
   * per `ERROR_ALERT_WINDOW_MS`. A transient fault (network, timeout, Telegram
   * 429/5xx) gets no instant alert; the daily triage counts it instead.
   * `where` is a content-free label (`describeUpdate`); never throws.
   */
  async reportError(
    where: string,
    err: unknown,
    userId: string | null = null,
    now: number = Date.now(),
  ): Promise<void> {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const transient = isTransientError(err);
    if (transient) this.logger.warn(`${where} failed (transient): ${message}`);
    else this.logger.error(`${where} failed: ${message}`);
    await recordEvent(this.db, userId, 'error', { where: where.slice(0, 80), message: message.slice(0, 200) });
    await recordErrorReport(this.db, where, message, transient, new Date(now));
    if (transient) return;

    const key = `${where}|${message}`;
    const last = this.errorAlerts.get(key);
    if (last !== undefined && now - last < ERROR_ALERT_WINDOW_MS) return;
    // A long-running process meets few distinct errors; the cap only guards
    // against a message that embeds an id and so never repeats.
    if (this.errorAlerts.size >= 200) this.errorAlerts.clear();
    this.errorAlerts.set(key, now);
    await this.notifyOwners((language) =>
      botMessage(language, 'owner.error')
        .replace('{where}', where)
        .replace('{user}', userId ?? '—')
        .replace('{message}', message),
    );
  }

  private async handleCommand(cmd: ParsedCommand): Promise<void> {
    const { chatId } = cmd;
    switch (cmd.command) {
      case 'start':
        await this.start(cmd);
        return;
      case 'stop':
        await this.stopFromChat(chatId);
        return;
      case 'delete':
        await this.askDelete(chatId);
        return;
      case 'testmode':
        await this.askTestMode(chatId);
        return;
      case 'help':
      case 'privacy':
      default: {
        const feature = this.commandHandlers.get(cmd.command);
        if (feature) {
          const ctx = await this.messageContext(chatId);
          if (ctx) {
            await feature(ctx, cmd.argument);
            return;
          }
          await this.replyToChat(chatId, 'text.noAccount', languageFromTelegram(cmd.languageCode));
          return;
        }
        const account = await this.accountByChat(chatId);
        const profile = account ? await this.profileOf(account.userId) : null;
        const language = profile?.language ?? languageFromTelegram(cmd.languageCode);
        const key = cmd.command === 'help' || cmd.command === 'privacy' ? cmd.command : 'unknown';
        if (key === 'help' && isOwnerRole(profile?.role)) {
          // The owner-only tools (ADR-024 §3) are listed to the owner alone.
          await this.replyTextToChat(
            chatId,
            `${botMessage(language, 'help')}\n\n${botMessage(language, 'help.owner')}`,
          );
          return;
        }
        await this.replyToChat(chatId, key, language);
      }
    }
  }

  /**
   * `/start`. With a token it is the second half of the web deep link; without
   * one it signs a Telegram user up, or reconnects a known one (ADR-024).
   */
  private async start(cmd: ParsedCommand): Promise<void> {
    const { chatId, username, fromId } = cmd;
    // A shared link's tag (`?start=dou_chat`, v2.6.0) is not a link token: the
    // sign-up goes on as a plain /start and remembers where the user came from.
    const source = startSource(cmd.argument);
    const token = source ? '' : cmd.argument;
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
    const telegramUser = fromId ? await this.accountByTelegramUser(fromId) : null;
    const fallbackLanguage = languageFromTelegram(cmd.languageCode);

    const outcome = resolveLink({
      token,
      pending,
      chatOwnerUserId: owner?.userId ?? null,
      telegramUserOwnerId: telegramUser?.userId ?? null,
      now,
    });

    // Test mode, two steps. The first /start after /testmode signs up the test
    // account (the owner moves from `testing:` to `parked:`); once that account
    // is deleted, the next /start brings the parked owner back.
    if (outcome.kind === 'register' && fromId) {
      const testStarts = await this.beginTest(fromId, now);
      if (!testStarts && (await this.unparkOwner(fromId, chatId, username, now))) return;
    }

    switch (outcome.kind) {
      case 'greet':
        await this.replyToChat(chatId, 'link.already', await this.languageOf(owner!.userId));
        return;
      case 'register':
        await this.register(cmd, fallbackLanguage, now, source);
        return;
      case 'relink':
        await this.attachChat(outcome.userId, chatId, username, now);
        await this.replyToChat(chatId, 'start.back', await this.languageOf(outcome.userId));
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
        // Remember who the person is, so a later plain `/start` after `/stop`
        // reconnects this account instead of creating a second one.
        if (fromId && !telegramUser) {
          await this.db
            .update(users)
            .set({ telegramUserId: fromId, updatedAt: now })
            .where(eq(users.id, outcome.userId));
        }
        await this.replyToChat(chatId, 'link.done', await this.languageOf(outcome.userId));
    }
  }

  /** A new account from a plain `/start`: no email, no password, this chat is the login. */
  private async register(
    cmd: ParsedCommand,
    language: Language,
    now: Date,
    source: string | null = null,
  ): Promise<void> {
    if (!cmd.fromId) {
      // Telegram always sends `from` in a private chat; without it there is no
      // identity to key the account on, so do nothing rather than guess.
      return;
    }
    const [created] = await this.db
      .insert(users)
      .values({ telegramUserId: cmd.fromId, language, role: 'user' })
      .onConflictDoNothing({ target: users.telegramUserId })
      .returning({ id: users.id });

    // A second `/start` racing the first lost the insert; the winner replies.
    if (!created) return;

    await this.attachChat(created.id, cmd.chatId, cmd.username, now);
    // Delivery settings exist from the first minute, so /settings always has a
    // row to change. Nothing is sent before the profile is confirmed (ADR-025
    // §2). Instant by default: the point of the bot is a vacancy within
    // minutes of posting (ADR-023), and quiet hours keep the nights silent.
    await this.db
      .insert(digestSettings)
      .values({ userId: created.id, mode: 'instant' })
      .onConflictDoNothing();
    await this.db
      .insert(plannerSettings)
      .values({ userId: created.id, timezone: defaultTimezone(language) })
      .onConflictDoNothing();
    await recordEvent(this.db, created.id, 'start', source ? { language, source } : { language });
    await this.replyToChat(cmd.chatId, 'start.welcome', language);
  }

  private async attachChat(
    userId: string,
    chatId: string,
    username: string | null,
    now: Date,
  ): Promise<void> {
    await this.db
      .insert(telegramAccounts)
      .values({ userId, chatId, username, linkedAt: now })
      .onConflictDoUpdate({
        target: telegramAccounts.userId,
        set: { chatId, username, linkedAt: now, updatedAt: now },
      });
  }

  /** Plain text goes to the open dialog's flow; without one the bot says what it expects. */
  private async handleText(parsed: ParsedText): Promise<void> {
    const ctx = await this.messageContext(parsed.chatId);
    if (!ctx) {
      await this.replyToChat(parsed.chatId, 'text.noAccount', languageFromTelegram(parsed.languageCode));
      return;
    }
    const dialog = await this.dialogs.current(parsed.chatId);
    const handler = dialog && dialog.userId === ctx.userId ? this.dialogHandlers.get(dialog.flow) : undefined;
    if (!dialog || !handler) {
      await this.replyToChat(parsed.chatId, 'text.noDialog', ctx.language);
      return;
    }
    await handler(ctx, parsed.text, dialog);
  }

  private async handleDocument(parsed: ParsedDocument): Promise<void> {
    const ctx = await this.messageContext(parsed.chatId);
    if (!ctx) {
      await this.replyToChat(parsed.chatId, 'text.noAccount', languageFromTelegram(parsed.languageCode));
      return;
    }
    if (!this.documentHandler) return;
    await this.documentHandler(ctx, parsed);
  }

  private async messageContext(chatId: string): Promise<BotMessageContext | null> {
    const account = await this.accountByChat(chatId);
    if (!account) return null;
    const profile = await this.profileOf(account.userId);
    return { userId: account.userId, chatId, ...profile };
  }

  // -------------------------------------------------------------------------
  // Account deletion (ADR-024 §8)
  // -------------------------------------------------------------------------

  private async askDelete(chatId: string): Promise<void> {
    if (!this.api) return;
    const account = await this.accountByChat(chatId);
    if (!account) {
      await this.replyToChat(chatId, 'delete.notLinked');
      return;
    }
    const language = await this.languageOf(account.userId);
    const ns = BOT_CALLBACK_NAMESPACES.account;
    try {
      await this.api.sendMessage(chatId, escapeHtml(botMessage(language, 'delete.confirm')), {
        parseMode: 'HTML',
        keyboard: [
          [
            { text: botMessage(language, 'delete.yes'), callbackData: `${ns}:del:y` },
            { text: botMessage(language, 'delete.no'), callbackData: `${ns}:del:n` },
          ],
        ],
      });
    } catch (err) {
      this.logger.warn(
        `delete prompt to chat ${chatId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleAccountCallback(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    const [, action, answer] = ctx.parts;
    if (action === 'test') return this.confirmTestMode(ctx, answer === 'y');
    if (action !== 'del') return {};

    if (answer !== 'y') {
      return { editText: escapeHtml(botMessage(ctx.language, 'delete.cancelled')), editKeyboard: null };
    }
    if (isOwnerRole(ctx.role)) {
      return { alert: botMessage(ctx.language, 'delete.owner') };
    }
    // Recorded before the row goes, so the funnel counts it; the FK then nulls
    // the user id and nothing personal is left in the event.
    await recordEvent(this.db, ctx.userId, 'account_deleted');
    // Every table keyed to a user cascades on delete (schema.ts).
    await this.db.delete(users).where(eq(users.id, ctx.userId));
    return { editText: escapeHtml(botMessage(ctx.language, 'delete.done')), editKeyboard: null };
  }

  // -------------------------------------------------------------------------
  // Test mode: the owner walks the new-user flow from their own Telegram
  // -------------------------------------------------------------------------

  /** `/testmode`, owner only: asks before parking the owner account. */
  private async askTestMode(chatId: string): Promise<void> {
    if (!this.api) return;
    const account = await this.accountByChat(chatId);
    const profile = account ? await this.profileOf(account.userId) : null;
    if (!account || !profile || !isOwnerRole(profile.role)) {
      await this.replyToChat(chatId, 'unknown', profile?.language);
      return;
    }
    const ns = BOT_CALLBACK_NAMESPACES.account;
    try {
      await this.api.sendMessage(chatId, escapeHtml(botMessage(profile.language, 'testmode.confirm')), {
        parseMode: 'HTML',
        keyboard: [
          [
            { text: botMessage(profile.language, 'testmode.yes'), callbackData: `${ns}:test:y` },
            { text: botMessage(profile.language, 'testmode.no'), callbackData: `${ns}:test:n` },
          ],
        ],
      });
    } catch (err) {
      this.logger.warn(
        `test-mode prompt to chat ${chatId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Parks the owner account: its Telegram user id gets a `parked:` prefix and
   * the chat is unlinked, so the next plain /start registers a fresh account
   * exactly as a stranger's would. Nothing of the owner's is deleted; the
   * owner's own deliveries pause until the way back (`unparkOwner`).
   */
  private async confirmTestMode(ctx: BotCallbackContext, yes: boolean): Promise<BotCallbackResult> {
    if (!yes) {
      return { editText: escapeHtml(botMessage(ctx.language, 'testmode.cancelled')), editKeyboard: null };
    }
    if (!isOwnerRole(ctx.role)) return { alert: botMessage(ctx.language, 'callback.ownerOnly') };
    const [row] = await this.db
      .select({ telegramUserId: users.telegramUserId })
      .from(users)
      .where(eq(users.id, ctx.userId));
    // In a private chat the chat id is the user id, which covers an owner
    // linked from the web before `telegram_user_id` existed.
    const telegramUserId = row?.telegramUserId ?? ctx.chatId;
    await this.db
      .update(users)
      .set({ telegramUserId: testingTelegramUserId(telegramUserId), updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));
    await this.unlink(ctx.userId);
    return { editText: escapeHtml(botMessage(ctx.language, 'testmode.on')), editKeyboard: null };
  }

  /**
   * The /start that opens a test: an owner waiting under `testing:` is parked,
   * and the caller registers the test account. False when no test is waiting.
   */
  private async beginTest(fromId: string, now: Date): Promise<boolean> {
    const waiting = await this.accountByTelegramUser(testingTelegramUserId(fromId));
    if (!waiting) return false;
    await this.db
      .update(users)
      .set({ telegramUserId: parkedTelegramUserId(fromId), updatedAt: now })
      .where(eq(users.id, waiting.userId));
    return true;
  }

  /** Re-attaches a parked owner account to its Telegram user; false when there is none. */
  private async unparkOwner(
    fromId: string,
    chatId: string,
    username: string | null,
    now: Date,
  ): Promise<boolean> {
    const parked = await this.accountByTelegramUser(parkedTelegramUserId(fromId));
    if (!parked) return false;
    await this.db
      .update(users)
      .set({ telegramUserId: fromId, updatedAt: now })
      .where(eq(users.id, parked.userId));
    await this.attachChat(parked.userId, chatId, username, now);
    await this.replyToChat(chatId, 'testmode.off', await this.languageOf(parked.userId));
    return true;
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
    const profile = account ? await this.profileOf(account.userId) : null;
    const language = profile?.language ?? DEFAULT_BOT_LANGUAGE;

    if (!account || !handler) {
      await this.answerCallback(parsed.callbackId, botMessage(language, 'callback.stale'));
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
        role: profile?.role ?? 'user',
      });
    } catch (err) {
      await this.reportError(`button ${parsed.parts.slice(0, 2).join(':')}`, err, account.userId);
      await this.answerCallback(parsed.callbackId, botMessage(language, 'callback.failed'));
      return;
    }

    // Answer first: the client spinner is waiting, and an edit may be slower.
    // A failed answer must not cost the edit: the press itself has worked.
    await this.answerCallback(parsed.callbackId, result?.alert);
    if (result?.editText !== undefined) {
      await this.editMessage(parsed.chatId, parsed.messageId, result.editText, {
        parseMode: 'HTML',
        disablePreview: true,
        keyboard: result.editKeyboard ?? [],
      });
    } else if (result?.editKeyboard !== undefined) {
      await this.editKeyboard(parsed.chatId, parsed.messageId, result.editKeyboard ?? []);
    }
  }

  /**
   * Stops the spinner on the pressed button. Best-effort: losing the answer
   * (a dropped connection, a query Telegram already expired) only leaves the
   * spinner a few seconds longer, while throwing would skip the edit and make
   * the press look ignored.
   */
  private async answerCallback(callbackId: string, text?: string): Promise<void> {
    try {
      await this.api?.answerCallbackQuery(callbackId, text);
    } catch (err) {
      this.logger.warn(`callback answer failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Swaps the buttons of a sent message; best-effort, like `editMessage`. */
  private async editKeyboard(
    chatId: string,
    messageId: number,
    keyboard: InlineKeyboard,
  ): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.editMessageReplyMarkup(chatId, messageId, keyboard);
    } catch (err) {
      this.logger.warn(
        `edit keyboard of message ${messageId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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

  private async accountByTelegramUser(telegramUserId: string) {
    const [row] = await this.db
      .select({ userId: users.id })
      .from(users)
      .where(eq(users.telegramUserId, telegramUserId));
    return row ?? null;
  }

  private async languageOf(userId: string): Promise<Language> {
    return (await this.profileOf(userId)).language;
  }

  private async profileOf(userId: string): Promise<{ language: Language; role: UserRole }> {
    const [row] = await this.db
      .select({ language: users.language, role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    return {
      language: row?.language === 'en' ? 'en' : 'ru',
      role: isOwnerRole(row?.role) ? 'owner' : 'user',
    };
  }

  private async replyToChat(
    chatId: string,
    key: Parameters<typeof botMessage>[1],
    language: Language = DEFAULT_BOT_LANGUAGE,
  ): Promise<void> {
    await this.replyTextToChat(chatId, botMessage(language, key));
  }

  /** Sends plain text (escaped here) to a chat; best-effort. */
  private async replyTextToChat(chatId: string, text: string): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.sendMessage(chatId, escapeHtml(text), {
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

/**
 * Where /testmode keeps the owner's Telegram user id until the next /start
 * signs up the test account; without this step that /start would bring the
 * owner straight back (the v2.3.0 bug: "the chat is linked again").
 */
export function testingTelegramUserId(telegramUserId: string): string {
  return `testing:${telegramUserId}`;
}

/** Where /testmode keeps the owner's Telegram user id while a test account uses it. */
export function parkedTelegramUserId(telegramUserId: string): string {
  return `parked:${telegramUserId}`;
}
