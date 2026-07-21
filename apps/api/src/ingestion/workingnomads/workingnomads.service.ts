import { Inject, Injectable, Logger } from '@nestjs/common';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import {
  isWorkingNomadsJobItem,
  normalizeWorkingNomadsItem,
  type WorkingNomadsItem,
} from './workingnomads-normalize';

interface WorkingNomadsSourceConfig {
  feedUrl?: string;
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

@Injectable()
export class WorkingNomadsIngestService {
  private readonly logger = new Logger(WorkingNomadsIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as WorkingNomadsSourceConfig;
    const feedUrl = config.feedUrl ?? 'https://www.workingnomads.com/api/exposed_jobs/';

    const res = await fetch(feedUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(`workingnomads request failed: ${res.status} ${res.statusText}`);
    }
    const items = (await res.json()) as WorkingNomadsItem[];

    const rows = items
      .filter(isWorkingNomadsJobItem)
      .map((item) => normalizeWorkingNomadsItem(item, source.id));
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;

    this.logger.log(`workingnomads ingest: fetched ${rows.length}, upserted ${upserted}`);
    return { fetched: rows.length, upserted };
  }
}
