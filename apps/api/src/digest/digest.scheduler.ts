import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DigestSendService } from './digest-send.service';

/**
 * Five minutes: send times are `HH:MM`, but a digest is not a minute-precision
 * event, and a coarser interval means fewer wake-ups on a sleeping free-tier
 * instance. The grace window in `due.ts` (3h) is what actually decides whether
 * a late slot still goes out.
 */
export const DEFAULT_DIGEST_INTERVAL_MS = 300_000;

/**
 * Runs the digest on a plain in-process interval, for the same reasons the
 * planner tick does (revised ADR-015 §7): the run only touches Postgres and
 * Telegram, a GitHub Actions cron cannot hit per-user local times without
 * firing constantly, and BullMQ polling would burn the Upstash free tier.
 *
 * Idempotency comes from the DB, not the scheduler: `digest_settings.last_sent_key`
 * consumes a slot exactly once, and `digest_items` makes re-sending a vacancy
 * impossible even if a run is repeated.
 */
@Injectable()
export class DigestScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly digest: DigestSendService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Kill switch from the Render dashboard, no deploy needed.
    if (this.isDisabled()) {
      this.logger.warn('digest disabled via DIGEST_DISABLED — nothing will be sent');
      return;
    }
    const interval = this.intervalMs();
    this.timer = setInterval(() => void this.fire(), interval);
    this.timer.unref?.();
    this.logger.log(`digest scheduled every ${interval / 1000}s (in-process)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private isDisabled(): boolean {
    const raw = (this.config.get<string>('DIGEST_DISABLED') ?? '').toLowerCase();
    return raw === '1' || raw === 'true';
  }

  private intervalMs(): number {
    const raw = Number(this.config.get<string>('DIGEST_INTERVAL_MS'));
    return Number.isFinite(raw) && raw >= 60_000 ? raw : DEFAULT_DIGEST_INTERVAL_MS;
  }

  /** Never overlap runs; never let one failure kill the interval. */
  private async fire(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.digest.run();
    } catch (err) {
      this.logger.error(`digest run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
