import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApplicationRemindersService } from './application-reminders.service';

/** Sweep interval: hourly is plenty for a reminder counted in days. */
export const REMINDER_SWEEP_INTERVAL_MS = 60 * 60_000;

/**
 * Runs the follow-up reminder sweep on a plain in-process interval, like the
 * planner tick and the digest (revised ADR-015 §7): it only reads and writes
 * Postgres, so a Redis queue would add nothing but Upstash commands.
 *
 * `APPLICATION_REMINDERS_DISABLED=1` switches it off without a deploy. Runs
 * never overlap, and a failed run never stops the interval.
 */
@Injectable()
export class ApplicationRemindersScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApplicationRemindersScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly reminders: ApplicationRemindersService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.isDisabled()) {
      this.logger.warn(
        'application reminders disabled via APPLICATION_REMINDERS_DISABLED — no follow-up nudges',
      );
      return;
    }
    this.timer = setInterval(() => void this.fire(), REMINDER_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
    this.logger.log(
      `application reminders scheduled every ${REMINDER_SWEEP_INTERVAL_MS / 60_000} min (in-process)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private isDisabled(): boolean {
    const raw = (this.config.get<string>('APPLICATION_REMINDERS_DISABLED') ?? '').toLowerCase();
    return raw === '1' || raw === 'true';
  }

  /** Never overlap sweeps, and never let one failure kill the interval. */
  private async fire(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.reminders.run();
      if (result.sent || result.failed) {
        this.logger.log(`application reminders — ${result.sent} sent, ${result.failed} failed`);
      }
    } catch (err) {
      this.logger.error(
        `application reminders failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
