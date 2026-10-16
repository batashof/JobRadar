import { Injectable, Logger } from '@nestjs/common';
import { daysSinceActivity } from '@jobradar/shared';

import { BotService } from '../bot/bot.service';
import { renderReminder } from './applications-bot-logic';
import { ApplicationsService } from './applications.service';
import { dueReminders, snoozeDays } from './reminder-logic';

export interface ReminderSweepResult {
  candidates: number;
  sent: number;
  failed: number;
}

/**
 * The IO half of the follow-up reminder sweep (roadmap 5.5): loads every
 * waiting application whose owner has a linked chat, lets `reminder-logic.ts`
 * pick the ones due now, sends each one message and stamps `reminded_at`.
 *
 * Idempotent: `reminded_at` is stamped only after a delivered send, and a
 * stamped application is not due again until new activity moves
 * `last_activity_at` past it, so a restart or an overlapping run never sends a
 * reminder twice. A failed send is retried on the next sweep.
 */
@Injectable()
export class ApplicationRemindersService {
  private readonly logger = new Logger(ApplicationRemindersService.name);

  constructor(
    private readonly applications: ApplicationsService,
    private readonly bot: BotService,
  ) {}

  async run(now = new Date()): Promise<ReminderSweepResult> {
    if (!this.bot.isConfigured()) return { candidates: 0, sent: 0, failed: 0 };

    const candidates = await this.applications.listReminderCandidates();
    const result: ReminderSweepResult = { candidates: candidates.length, sent: 0, failed: 0 };

    for (const candidate of dueReminders(candidates, now)) {
      try {
        const screen = renderReminder(candidate.language, {
          id: candidate.id,
          stage: candidate.stage,
          title: candidate.title,
          company: candidate.company,
          days: daysSinceActivity({ lastActivityAt: candidate.lastActivityAt.toISOString() }, now),
          snoozeDays: snoozeDays(candidate),
        });
        const messageId = await this.bot.sendToUser(candidate.userId, screen.text, {
          parseMode: 'HTML',
          keyboard: screen.keyboard,
        });
        if (!messageId) {
          result.failed += 1;
          continue;
        }
        await this.applications.markReminded(candidate.id, now);
        result.sent += 1;
      } catch (err) {
        // One user's failure never stops the reminders of everyone else.
        result.failed += 1;
        this.logger.error(
          `reminder for application ${candidate.id} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return result;
  }
}
