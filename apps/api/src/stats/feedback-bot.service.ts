import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Language } from '@jobradar/shared';
import { eq } from 'drizzle-orm';

import { BotDialogs } from '../bot/bot-dialogs';
import { type BotMessageContext, BotService } from '../bot/bot.service';
import { recordEvent } from '../common/events';
import { DB, type Database } from '../db/db.module';
import { telegramAccounts } from '../db/schema';
import { recordFeedbackReport } from '../triage/reports';

/** The dialog flow that waits for the feedback text after a bare `/feedback`. */
export const FEEDBACK_FLOW = 'feedback';

/** Longest feedback forwarded; Telegram's own message limit is 4096. */
export const FEEDBACK_MAX = 3000;

const TEXT = {
  en: {
    ask: 'Write in one message what is wrong, what is missing or what is confusing. I will pass it to the author of the bot.',
    thanks: 'Thank you! I passed it to the author.',
    forwarded: '💬 Feedback from {who} ({lang})\n\n{text}',
  },
  ru: {
    ask: 'Напиши одним сообщением, что не так, чего не хватает или что непонятно. Я передам это автору бота.',
    thanks: 'Спасибо! Передал автору.',
    forwarded: '💬 Отзыв от {who} ({lang})\n\n{text}',
  },
} as const;

export function feedbackText(lang: Language, key: keyof (typeof TEXT)['en']): string {
  return TEXT[lang][key];
}

/**
 * `/feedback` (v2.6.0): a user tells the author what is wrong. The text goes
 * to the owner's chat at once and into the triage inbox (ADR-037), where the
 * owner marks it to fix or skip; it is deleted with the account. `events`
 * keeps only that feedback was sent, for the count in `/stats`.
 */
@Injectable()
export class FeedbackBotService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
    private readonly dialogs: BotDialogs,
  ) {}

  onModuleInit(): void {
    this.bot.registerCommand('feedback', (ctx, argument) => this.command(ctx, argument));
    this.bot.registerDialog(FEEDBACK_FLOW, (ctx, text) => this.answer(ctx, text));
  }

  /** `/feedback some text` sends at once; a bare `/feedback` asks for the text. */
  async command(ctx: BotMessageContext, argument: string): Promise<void> {
    if (argument.trim()) {
      await this.forward(ctx, argument);
      return;
    }
    await this.dialogs.open(ctx.chatId, { userId: ctx.userId, flow: FEEDBACK_FLOW, step: 'text', payload: {} });
    await this.bot.sendToUser(ctx.userId, feedbackText(ctx.language, 'ask'));
  }

  async answer(ctx: BotMessageContext, text: string): Promise<void> {
    await this.dialogs.close(ctx.chatId);
    await this.forward(ctx, text);
  }

  private async forward(ctx: BotMessageContext, raw: string): Promise<void> {
    const text = raw.trim().slice(0, FEEDBACK_MAX);
    const [account] = await this.db
      .select({ username: telegramAccounts.username })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, ctx.userId));
    // A username lets the owner answer in Telegram; without one, the account id
    // is what to look up.
    const who = account?.username ? `@${account.username}` : ctx.userId;
    await recordEvent(this.db, ctx.userId, 'feedback', { length: text.length });
    await recordFeedbackReport(this.db, ctx.userId, text);
    await this.bot.notifyOwners((language) =>
      feedbackText(language, 'forwarded')
        .replace('{who}', who)
        .replace('{lang}', ctx.language)
        .replace('{text}', text),
    );
    await this.bot.sendToUser(ctx.userId, feedbackText(ctx.language, 'thanks'));
  }
}
