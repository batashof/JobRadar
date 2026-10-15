import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { botDialogs } from '../db/schema';

/** How long the bot waits for a typed answer before forgetting the question. */
export const DIALOG_TTL_MINUTES = 30;

export interface OpenDialog {
  userId: string;
  flow: string;
  step: string;
  payload: Record<string, unknown>;
}

/**
 * What the bot is waiting for in a chat (ADR-024 §4). One open dialog per
 * chat: opening a new one replaces the old, which is what a user who presses a
 * different button midway expects. Stored in Postgres so a Render restart
 * between the question and the answer loses nothing.
 */
@Injectable()
export class BotDialogs {
  constructor(@Inject(DB) private readonly db: Database) {}

  async open(
    chatId: string,
    dialog: OpenDialog,
    now: Date = new Date(),
  ): Promise<void> {
    const expiresAt = new Date(now.getTime() + DIALOG_TTL_MINUTES * 60_000);
    const values = { ...dialog, expiresAt, updatedAt: now };
    await this.db
      .insert(botDialogs)
      .values({ chatId, ...values })
      .onConflictDoUpdate({ target: botDialogs.chatId, set: values });
  }

  /** The chat's dialog, or null when there is none or it has expired. */
  async current(chatId: string, now: Date = new Date()): Promise<OpenDialog | null> {
    const [row] = await this.db.select().from(botDialogs).where(eq(botDialogs.chatId, chatId));
    if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
    return { userId: row.userId, flow: row.flow, step: row.step, payload: row.payload ?? {} };
  }

  async close(chatId: string): Promise<void> {
    await this.db.delete(botDialogs).where(eq(botDialogs.chatId, chatId));
  }
}
