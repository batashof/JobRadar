import { Injectable, Logger } from '@nestjs/common';

import { IngestionProcessor } from './ingestion.processor';
import type { IngestJobData } from './ingestion.types';

/**
 * The ingestion queue, in process (ADR-031). One Render instance runs the API,
 * so a FIFO array with one worker loop is all the ordering the jobs need:
 * sources first, then dedup, then matching. It replaced a BullMQ queue whose
 * every job and idle poll was a paid-for command on Upstash's 500k/month free
 * tier, enough to exhaust it with a 10-minute tick.
 *
 * Nothing survives a restart, and nothing needs to: `sources.last_run_at` is in
 * Postgres, so the next tick enqueues whatever is still due. A failed source
 * is not retried here either; `schedule.ts` retries it after an hour.
 */
@Injectable()
export class IngestionQueue {
  private readonly logger = new Logger(IngestionQueue.name);
  private readonly pending: { name: string; data: IngestJobData }[] = [];
  private draining: Promise<void> | null = null;

  constructor(private readonly processor: IngestionProcessor) {}

  /**
   * Adds a job and starts the worker loop if it is idle; never waits for the
   * job. A job whose name is already waiting is not added twice, so a tick
   * that arrives while the previous one is still running doesn't stack up.
   */
  add(name: string, data: IngestJobData): boolean {
    if (this.pending.some((job) => job.name === name)) return false;
    this.pending.push({ name, data });
    this.draining ??= this.drain().finally(() => {
      this.draining = null;
    });
    return true;
  }

  /** Jobs not started yet. */
  size(): number {
    return this.pending.length;
  }

  /** Resolves once the queue is empty; for tests and graceful waits. */
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    // Let the caller finish its synchronous adds (the HTTP tick answers 202 first).
    await Promise.resolve();
    for (let job = this.pending.shift(); job; job = this.pending.shift()) {
      try {
        await this.processor.process(job.data);
      } catch (error) {
        // The processor already marked the source and told Sentry; one failed
        // job must not stop the ones queued behind it.
        this.logger.error(
          `${job.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
