import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { BOT_CALLBACK_NAMESPACES, isOwnerRole, type Language } from '@jobradar/shared';

import {
  type BotCallbackContext,
  type BotCallbackResult,
  type BotMessageContext,
  BotService,
} from '../bot/bot.service';
import type { InlineKeyboard } from '../bot/telegram-api';
import { GmailService } from './gmail.service';

const NS = BOT_CALLBACK_NAMESPACES.gmail;

const TEXT = {
  en: {
    ownerOnly: 'This command is available to the author only.',
    notConfigured: 'Gmail is not set up on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
    connected:
      '📧 Gmail is connected. Applications from a vacancy card are sent from your mailbox.',
    disconnected:
      '📧 Gmail is not connected. Connect it to send applications from a vacancy card by email.',
    connect: '🔗 Connect Gmail',
    reconnect: '🔄 Reconnect',
    disconnect: '✖️ Disconnect',
    disconnectedNow: 'Gmail disconnected.',
  },
  ru: {
    ownerOnly: 'Эта команда доступна только автору.',
    notConfigured: 'Gmail не настроен на сервере (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
    connected: '📧 Gmail подключён. Отклики с карточки вакансии уходят с вашего ящика.',
    disconnected:
      '📧 Gmail не подключён. Подключите его, чтобы отправлять отклики с карточки вакансии письмом.',
    connect: '🔗 Подключить Gmail',
    reconnect: '🔄 Переподключить',
    disconnect: '✖️ Отключить',
    disconnectedNow: 'Gmail отключён.',
  },
} as const;

export type GmailTextKey = keyof (typeof TEXT)['en'];

export function gmailText(lang: Language, key: GmailTextKey): string {
  return TEXT[lang][key];
}

/** The status message's buttons: a consent link, plus disconnect when connected. */
export function gmailKeyboard(lang: Language, connected: boolean, authUrl: string): InlineKeyboard {
  const rows: InlineKeyboard = [
    [{ text: gmailText(lang, connected ? 'reconnect' : 'connect'), url: authUrl }],
  ];
  if (connected) rows.push([{ text: gmailText(lang, 'disconnect'), callbackData: `${NS}:x` }]);
  return rows;
}

/**
 * `/gmail` in the bot (2.0.0, ADR-028): the Gmail connection the website's
 * resume page used to manage. The consent link carries the signed user id in
 * OAuth `state`, so Google's callback needs no web session. Owner only
 * (ADR-024 §3: personal credentials).
 */
@Injectable()
export class GmailBotService implements OnModuleInit {
  private readonly logger = new Logger(GmailBotService.name);

  constructor(
    private readonly bot: BotService,
    private readonly gmail: GmailService,
  ) {}

  onModuleInit(): void {
    this.bot.registerCommand('gmail', (ctx) => this.show(ctx));
    this.bot.registerCallback(NS, (ctx) => this.onCallback(ctx));
  }

  async show(ctx: BotMessageContext): Promise<void> {
    if (!isOwnerRole(ctx.role)) {
      await this.bot.sendToUser(ctx.userId, gmailText(ctx.language, 'ownerOnly'));
      return;
    }
    const status = await this.gmail.statusFor(ctx.userId);
    if (!status.configured) {
      await this.bot.sendToUser(ctx.userId, gmailText(ctx.language, 'notConfigured'));
      return;
    }
    await this.bot.sendToUser(
      ctx.userId,
      gmailText(ctx.language, status.connected ? 'connected' : 'disconnected'),
      { keyboard: gmailKeyboard(ctx.language, status.connected, this.gmail.authUrl(ctx.userId)) },
    );
  }

  async onCallback(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    if (!isOwnerRole(ctx.role)) return { alert: gmailText(ctx.language, 'ownerOnly') };
    if (ctx.parts[1] !== 'x') return {};
    await this.gmail.disconnect(ctx.userId);
    this.logger.log(`gmail disconnected for ${ctx.userId}`);
    return {
      alert: gmailText(ctx.language, 'disconnectedNow'),
      editText: gmailText(ctx.language, 'disconnected'),
      editKeyboard: this.gmail.isConfigured()
        ? gmailKeyboard(ctx.language, false, this.gmail.authUrl(ctx.userId))
        : null,
    };
  }
}
