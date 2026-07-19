import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { sources } from '../db/schema';
import { INGESTION_QUEUE, type IngestJobData } from './ingestion.types';
import { IngestionTokenGuard } from './ingestion-token.guard';

@Controller('ingestion')
@UseGuards(IngestionTokenGuard)
export class IngestionController {
  constructor(
    @InjectQueue(INGESTION_QUEUE) private readonly queue: Queue<IngestJobData>,
    @Inject(DB) private readonly db: Database,
  ) {}

  /** Enqueues one ingestion job per active source. Idempotent and cheap to re-run. */
  @Post('run')
  @HttpCode(202)
  async run(@Body() body?: { force?: boolean }): Promise<{ enqueued: string[] }> {
    const active = await this.db
      .select({ slug: sources.slug })
      .from(sources)
      .where(eq(sources.isActive, true));

    const jobOptions = {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    };
    for (const { slug } of active) {
      await this.queue.add(
        `ingest:${slug}`,
        { kind: 'source', slug, force: body?.force === true },
        jobOptions,
      );
    }
    // FIFO with concurrency 1 → dedup runs after all source jobs above.
    await this.queue.add('dedup', { kind: 'dedup' }, jobOptions);
    return { enqueued: [...active.map((s) => s.slug), 'dedup'] };
  }
}
