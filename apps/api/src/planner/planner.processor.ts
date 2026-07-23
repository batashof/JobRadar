import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { PlannerTickService, type TickResult } from './planner-tick.service';

export const PLANNER_QUEUE = 'planner';
export const PLANNER_TICK_JOB = 'planner-tick';
/** Minute granularity: the finest thing the planner ever reacts to (ADR-015 §7). */
export const TICK_INTERVAL_MS = 60_000;

/**
 * Registers the repeatable tick on boot. A scheduler that has to be re-armed
 * manually is a scheduler that silently stops, so this is idempotent — BullMQ
 * upserts by id — and a Redis outage only logs, never blocks bootstrap.
 */
@Injectable()
export class PlannerScheduler implements OnModuleInit {
  private readonly logger = new Logger(PlannerScheduler.name);

  constructor(@InjectQueue(PLANNER_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        PLANNER_TICK_JOB,
        { every: TICK_INTERVAL_MS },
        { name: PLANNER_TICK_JOB, opts: { removeOnComplete: 20, removeOnFail: 50 } },
      );
      this.logger.log(`planner:tick scheduled every ${TICK_INTERVAL_MS / 1000}s`);
    } catch (err) {
      this.logger.error(
        `Could not schedule planner:tick — nudges and auto-close will not run: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

@Processor(PLANNER_QUEUE)
export class PlannerProcessor extends WorkerHost {
  private readonly logger = new Logger(PlannerProcessor.name);

  constructor(private readonly tick: PlannerTickService) {
    super();
  }

  async process(job: Job): Promise<TickResult> {
    const result = await this.tick.run();
    // Quiet ticks are the normal case; only log when something happened.
    if (result.autoClosed || result.raised || result.escalated || result.ignored) {
      this.logger.log(
        `${job.name}: ${result.raised} nudge(s), ${result.autoClosed} day(s) auto-closed, ` +
          `${result.escalated} escalated, ${result.ignored} ignored`,
      );
    }
    return result;
  }
}
