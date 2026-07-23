import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PlannerTickService } from './planner-tick.service';

/**
 * Interval between ticks. Configurable so it can be relaxed without a deploy —
 * only the midway ping wants minute precision. `PLANNER_TICK_INTERVAL_MS`
 * overrides it; defaults to one minute.
 */
export const DEFAULT_TICK_INTERVAL_MS = 60_000;

/**
 * Runs `planner:tick` on a plain in-process interval — deliberately **not** a
 * BullMQ queue (revised ADR-015 §7): the tick only ever reads/writes Postgres,
 * so a Redis-backed queue added no safety and burned the Upstash free-tier
 * command budget through BullMQ's continuous polling. Restart-safety comes from
 * the tick's idempotent DB writes (a nudge is raised at most once, a day closes
 * on its status), not from the scheduler.
 *
 * Single-instance only (Render free tier). The keep-alive ping keeps the
 * process warm; if it ever sleeps the interval pauses and resumes on wake —
 * the same liveness assumption the BullMQ version had.
 */
@Injectable()
export class PlannerScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlannerScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly tick: PlannerTickService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Kill switch: set PLANNER_TICK_DISABLED=1 (e.g. in the Render dashboard) to
    // stop nudges and auto-close entirely, no deploy needed.
    if (this.isDisabled()) {
      this.logger.warn('planner:tick disabled via PLANNER_TICK_DISABLED — nudges and auto-close are off');
      return;
    }
    const interval = this.intervalMs();
    this.timer = setInterval(() => void this.fire(), interval);
    // Do not keep the event loop alive just for the tick (clean shutdown).
    this.timer.unref?.();
    this.logger.log(`planner:tick scheduled every ${interval / 1000}s (in-process)`);
  }

  private isDisabled(): boolean {
    const raw = (this.config.get<string>('PLANNER_TICK_DISABLED') ?? '').toLowerCase();
    return raw === '1' || raw === 'true';
  }

  private intervalMs(): number {
    const raw = Number(this.config.get<string>('PLANNER_TICK_INTERVAL_MS'));
    return Number.isFinite(raw) && raw >= 10_000 ? raw : DEFAULT_TICK_INTERVAL_MS;
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Never overlap ticks, and never let one failure kill the interval. */
  private async fire(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.tick.run();
      if (result.autoClosed || result.raised || result.escalated || result.ignored) {
        this.logger.log(
          `planner:tick — ${result.raised} nudge(s), ${result.autoClosed} day(s) auto-closed, ` +
            `${result.escalated} escalated, ${result.ignored} ignored`,
        );
      }
    } catch (err) {
      this.logger.error(
        `planner:tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
