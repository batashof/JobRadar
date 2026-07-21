import { Inject, Injectable, Logger } from '@nestjs/common';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import { isRemotiveJobItem, normalizeRemotiveItem, type RemotiveItem } from './remotive-normalize';

interface RemotiveSourceConfig {
  feedUrl?: string;
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

@Injectable()
export class RemotiveIngestService {
  private readonly logger = new Logger(RemotiveIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as RemotiveSourceConfig;
    const feedUrl =
      config.feedUrl ?? 'https://remotive.com/api/remote-jobs?category=software-dev';

    const res = await fetch(feedUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(`remotive request failed: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as { jobs?: RemotiveItem[] };
    const items = payload.jobs ?? [];

    const rows = items.filter(isRemotiveJobItem).map((item) => normalizeRemotiveItem(item, source.id));
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;

    this.logger.log(`remotive ingest: fetched ${rows.length}, upserted ${upserted}`);
    return { fetched: rows.length, upserted };
  }
}
