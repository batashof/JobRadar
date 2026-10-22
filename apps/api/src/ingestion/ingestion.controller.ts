import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { sources } from '../db/schema';
import { IngestionQueue } from './ingestion-queue';
import { IngestionTokenGuard } from './ingestion-token.guard';
import { isSourceDue } from './schedule';

@Controller('ingestion')
@UseGuards(IngestionTokenGuard)
export class IngestionController {
  constructor(
    private readonly queue: IngestionQueue,
    @Inject(DB) private readonly db: Database,
  ) {}

  /**
   * Called every 10 minutes (ADR-023). Enqueues a job for each active source
   * whose own interval has elapsed (`schedule.ts`), then dedup and matching —
   * or nothing at all when no source is due, so an idle tick costs one small
   * query. The jobs run in process after the 202 (ADR-031). `force` enqueues
   * every active source.
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

    for (const { slug } of active) {
      this.queue.add(`ingest:${slug}`, { kind: 'source', slug, force });
    }
    // FIFO, one job at a time → dedup runs after all source jobs above,
    // then matching recomputes against the deduplicated canonical set.
    this.queue.add('dedup', { kind: 'dedup' });
    this.queue.add('match', { kind: 'match' });
    return { enqueued: [...active.map((s) => s.slug), 'dedup', 'match'] };
  }
}
