import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { PlannerTickService } from './planner-tick.service';

/** Minute granularity: the finest thing the planner ever reacts to (ADR-015 §7). */
export const TICK_INTERVAL_MS = 60_000;

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

  constructor(private readonly tick: PlannerTickService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.fire(), TICK_INTERVAL_MS);
    // Do not keep the event loop alive just for the tick (clean shutdown).
    this.timer.unref?.();
    this.logger.log(`planner:tick scheduled every ${TICK_INTERVAL_MS / 1000}s (in-process)`);
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
