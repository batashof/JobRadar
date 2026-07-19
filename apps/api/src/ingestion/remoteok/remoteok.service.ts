import { Inject, Injectable, Logger } from '@nestjs/common';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import { isJobItem, normalizeRemoteOkItem, type RemoteOkItem } from './remoteok-normalize';

interface RemoteOkSourceConfig {
  feedUrl?: string;
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

@Injectable()
export class RemoteOkIngestService {
  private readonly logger = new Logger(RemoteOkIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as RemoteOkSourceConfig;
    const feedUrl = config.feedUrl ?? 'https://remoteok.com/api';

    const res = await fetch(feedUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(`remoteok request failed: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as RemoteOkItem[];

    const rows = payload.filter(isJobItem).map((item) => normalizeRemoteOkItem(item, source.id));
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;

    this.logger.log(`remoteok ingest: fetched ${rows.length}, upserted ${upserted}`);
    return { fetched: rows.length, upserted };
  }
}
