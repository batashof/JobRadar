import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { sources } from '../db/schema';
import { INGESTION_QUEUE, type IngestJobData } from './ingestion.types';
import { IngestionTokenGuard } from './ingestion-token.guard';
import { isSourceDue } from './schedule';

@Controller('ingestion')
@UseGuards(IngestionTokenGuard)
export class IngestionController {
  constructor(
    @InjectQueue(INGESTION_QUEUE) private readonly queue: Queue<IngestJobData>,
    @Inject(DB) private readonly db: Database,
  ) {}

  /**
   * Called every 10 minutes (ADR-023). Enqueues a job for each active source
   * whose own interval has elapsed (`schedule.ts`), then dedup and matching —
   * or nothing at all when no source is due, so an idle tick costs one small
   * query and no Upstash commands. `force` enqueues every active source.
   */
  @Post('run')
  @HttpCode(202)
  async run(@Body() body?: { force?: boolean }): Promise<{ enqueued: string[] }> {
    const force = body?.force === true;
    const rows = await this.db
      .select({
        slug: sources.slug,
        lastRunAt: sources.lastRunAt,
        lastRunStatus: sources.lastRunStatus,
      })
      .from(sources)
      .where(eq(sources.isActive, true));
    const now = new Date();
    const active = rows.filter((source) => isSourceDue(source, now, force));
    if (active.length === 0) return { enqueued: [] };

    const jobOptions = {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    };
    for (const { slug } of active) {
      await this.queue.add(`ingest:${slug}`, { kind: 'source', slug, force }, jobOptions);
    }
    // FIFO with concurrency 1 → dedup runs after all source jobs above,
    // then matching recomputes against the deduplicated canonical set.
    await this.queue.add('dedup', { kind: 'dedup' }, jobOptions);
    await this.queue.add('match', { kind: 'match' }, jobOptions);
    return { enqueued: [...active.map((s) => s.slug), 'dedup', 'match'] };
  }
}
