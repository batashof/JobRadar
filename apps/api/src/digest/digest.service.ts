import { Inject, Injectable } from '@nestjs/common';
import {
  DIGEST_DEFAULTS,
  type DigestSettings,
  PLANNER_DEFAULTS,
  sortSendTimes,
  type UpdateDigestSettingsInput,
} from '@jobradar/shared';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { digestSettings, plannerSettings } from '../db/schema';

/**
 * Configuration for the daily vacancy digest. The sending itself lands in the
 * next increment and reads exactly these rows; keeping the settings separate
 * means the schedule can be chosen before there is anything to schedule.
 */
@Injectable()
export class DigestService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getSettings(userId: string): Promise<DigestSettings> {
    const row = await this.settingsRow(userId);
    return this.toSettings(userId, row);
  }

  async updateSettings(
    userId: string,
    input: UpdateDigestSettingsInput,
  ): Promise<DigestSettings> {
    await this.settingsRow(userId);

    const [updated] = await this.db
      .update(digestSettings)
      .set({
        ...input,
        // Stored sorted so "the next send" is a scan from the front.
        ...(input.sendTimes ? { sendTimes: sortSendTimes(input.sendTimes) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(digestSettings.userId, userId))
      .returning();

    return this.toSettings(userId, updated);
  }

  /** Lazily creates the row, so a user never has to "enable" the feature first. */
  private async settingsRow(userId: string) {
    const [existing] = await this.db
      .select()
      .from(digestSettings)
      .where(eq(digestSettings.userId, userId));
    if (existing) return existing;

    const [created] = await this.db
      .insert(digestSettings)
      .values({ userId })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    // Lost the insert race — the row exists now.
    const [row] = await this.db
      .select()
      .from(digestSettings)
      .where(eq(digestSettings.userId, userId));
    return row;
  }

  /**
   * The timezone is read from the planner's settings rather than duplicated
   * here (ADR-015 §7 made per-user timezone real state). A user who has never
   * opened the planner has no row yet, hence the shared default.
   */
  private async toSettings(
    userId: string,
    row: typeof digestSettings.$inferSelect | undefined,
  ): Promise<DigestSettings> {
    const [planner] = await this.db
      .select({ timezone: plannerSettings.timezone })
      .from(plannerSettings)
      .where(eq(plannerSettings.userId, userId));

    return {
      enabled: row?.enabled ?? DIGEST_DEFAULTS.enabled,
      sendTimes: row ? sortSendTimes(row.sendTimes) : [...DIGEST_DEFAULTS.sendTimes],
      maxItems: row?.maxItems ?? DIGEST_DEFAULTS.maxItems,
      minScore: row?.minScore ?? DIGEST_DEFAULTS.minScore,
      timezone: planner?.timezone ?? PLANNER_DEFAULTS.timezone,
    };
  }
}
