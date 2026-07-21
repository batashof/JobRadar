import { Inject, Injectable, Logger } from '@nestjs/common';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import { isJobicyJobItem, normalizeJobicyItem, type JobicyItem } from './jobicy-normalize';

interface JobicySourceConfig {
  feedUrl?: string;
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

@Injectable()
export class JobicyIngestService {
  private readonly logger = new Logger(JobicyIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as JobicySourceConfig;
    const feedUrl =
      config.feedUrl ?? 'https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50';

    const res = await fetch(feedUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(`jobicy request failed: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as { jobs?: JobicyItem[] };
    const items = payload.jobs ?? [];

    const rows = items.filter(isJobicyJobItem).map((item) => normalizeJobicyItem(item, source.id));
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;

    this.logger.log(`jobicy ingest: fetched ${rows.length}, upserted ${upserted}`);
    return { fetched: rows.length, upserted };
  }
}
