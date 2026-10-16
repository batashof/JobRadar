import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, eq, gte, isNull } from 'drizzle-orm';

import { type BotMessageContext, BotService } from '../../bot/bot.service';
import { DB, type Database } from '../../db/db.module';
import { users, vacancyRecipients } from '../../db/schema';
import {
  buildForwardingAddress,
  generateAlertsToken,
  instructionsText,
  unavailableText,
} from './linkedin-forwarding';

const RECENT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `/linkedin` in the bot (ADR-027): the user's personal forwarding address for
 * their own LinkedIn job alerts and how to set the forwarding up. The token is
 * generated the first time the command is opened and never changes after.
 */
@Injectable()
export class LinkedInBotService implements OnModuleInit {
  private readonly logger = new Logger(LinkedInBotService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly bot: BotService,
  ) {}

  onModuleInit(): void {
    this.bot.registerCommand('linkedin', (ctx) => this.show(ctx));
  }

  private async show(ctx: BotMessageContext): Promise<void> {
    const mailbox = this.config.get<string>('ALERTS_IMAP_USER')?.trim();
    const token = mailbox ? await this.ensureToken(ctx.userId) : null;
    const address = mailbox && token ? buildForwardingAddress(mailbox, token) : null;
    if (!address) {
      await this.bot.sendToUser(ctx.userId, unavailableText(ctx.language));
      return;
    }
    const recent = await this.recentCount(ctx.userId);
    await this.bot.sendToUser(ctx.userId, instructionsText(ctx.language, address, recent), {
      parseMode: 'HTML',
    });
  }

  /** The user's token, created on first use. */
  async ensureToken(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ token: users.alertsToken })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) return null;
    if (row.token) return row.token;

    // A collision on the unique column is astronomically unlikely (60 bits);
    // one retry covers it without a loop that could spin.
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = generateAlertsToken();
      try {
        await this.db
          .update(users)
          .set({ alertsToken: token, updatedAt: new Date() })
          // Only while unset: two /linkedin taps racing keep one token.
          .where(and(eq(users.id, userId), isNull(users.alertsToken)));
        const [saved] = await this.db
          .select({ token: users.alertsToken })
          .from(users)
          .where(eq(users.id, userId));
        return saved?.token ?? null;
      } catch (err) {
        this.logger.warn(
          `alerts token for ${userId} not saved: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return null;
  }

  /** Vacancies the user's forwarded alerts brought in over the last two weeks. */
  private async recentCount(userId: string): Promise<number> {
    const since = new Date(Date.now() - RECENT_DAYS * DAY_MS);
    const [row] = await this.db
      .select({ n: count() })
      .from(vacancyRecipients)
      .where(and(eq(vacancyRecipients.userId, userId), gte(vacancyRecipients.createdAt, since)));
    return Number(row?.n ?? 0);
  }
}
