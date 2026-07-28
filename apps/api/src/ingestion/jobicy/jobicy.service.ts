import { Inject, Injectable, Logger } from '@nestjs/common';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import { isJobicyJobItem, normalizeJobicyItem, type JobicyItem } from './jobicy-normalize';

interface JobicySourceConfig {
  /** Legacy single-feed config; `feedUrls` supersedes it. */
  feedUrl?: string;
  feedUrls?: string[];
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

const DEFAULT_FEED_URLS = ['https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50'];

@Injectable()
export class JobicyIngestService {
  private readonly logger = new Logger(JobicyIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as JobicySourceConfig;
    const feedUrls = config.feedUrls?.length
      ? config.feedUrls
      : config.feedUrl
        ? [config.feedUrl]
        : DEFAULT_FEED_URLS;

    // Industry feeds overlap (an ML role sits in both dev and data-science),
    // so dedupe by job id before hitting the database.
    const byExternalId = new Map<string, ReturnType<typeof normalizeJobicyItem>>();

    for (const feedUrl of feedUrls) {
      const res = await fetch(feedUrl, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) {
        throw new Error(`jobicy request failed: ${res.status} ${res.statusText}`);
      }
      const payload = (await res.json()) as { jobs?: JobicyItem[] };
      for (const item of (payload.jobs ?? []).filter(isJobicyJobItem)) {
        const row = normalizeJobicyItem(item, source.id);
        byExternalId.set(row.externalId, row);
      }
    }

    const rows = [...byExternalId.values()];
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;

    this.logger.log(
      `jobicy ingest: ${feedUrls.length} feed(s), fetched ${rows.length}, upserted ${upserted}`,
    );
    return { fetched: rows.length, upserted };
  }
}
