import { Inject, Injectable, Logger } from '@nestjs/common';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import {
  isHimalayasJobItem,
  normalizeHimalayasItem,
  type HimalayasItem,
} from './himalayas-normalize';

interface HimalayasSourceConfig {
  feedUrl?: string;
  /** How many pages to walk per run; the API caps a page at 20 items. */
  pages?: number;
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

const DEFAULT_FEED_URL = 'https://himalayas.app/jobs/api';
/** The API silently clamps `limit` to 20, so volume comes from paging. */
const PAGE_SIZE = 20;
/** 10 pages ≈ 200 newest postings per run, of which ~20% are tech roles. */
const DEFAULT_PAGES = 10;

@Injectable()
export class HimalayasIngestService {
  private readonly logger = new Logger(HimalayasIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as HimalayasSourceConfig;
    const feedUrl = config.feedUrl ?? DEFAULT_FEED_URL;
    const pages = config.pages ?? DEFAULT_PAGES;

    const byExternalId = new Map<string, ReturnType<typeof normalizeHimalayasItem>>();

    for (let page = 0; page < pages; page += 1) {
      const url = `${feedUrl}?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) {
        throw new Error(`himalayas request failed: ${res.status} ${res.statusText}`);
      }
      const payload = (await res.json()) as { jobs?: HimalayasItem[] };
      const items = payload.jobs ?? [];
      // A short page means the feed is exhausted — stop instead of hammering
      // offsets that return nothing (docs/DATA_SOURCES.md politeness rules).
      if (items.length === 0) break;

      for (const item of items.filter(isHimalayasJobItem)) {
        const row = normalizeHimalayasItem(item, source.id);
        byExternalId.set(row.externalId, row);
      }
      if (items.length < PAGE_SIZE) break;
    }

    const rows = [...byExternalId.values()];
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;

    this.logger.log(`himalayas ingest: fetched ${rows.length}, upserted ${upserted}`);
    return { fetched: rows.length, upserted };
  }
}
