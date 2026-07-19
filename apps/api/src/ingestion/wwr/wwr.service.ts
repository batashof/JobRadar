import { Inject, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import { isWwrJobItem, normalizeWwrItem, type WwrRssItem } from './wwr-normalize';

interface WwrSourceConfig {
  feedUrl?: string;
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

@Injectable()
export class WwrIngestService {
  private readonly logger = new Logger(WwrIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as WwrSourceConfig;
    const feedUrl =
      config.feedUrl ?? 'https://weworkremotely.com/categories/remote-programming-jobs.rss';

    // Conditional GET per docs/DATA_SOURCES.md politeness rules.
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (source.lastRunAt) headers['If-Modified-Since'] = source.lastRunAt.toUTCString();

    const res = await fetch(feedUrl, { headers });
    if (res.status === 304) {
      this.logger.log('wwr feed not modified since last run');
      return { fetched: 0, upserted: 0, notModified: true };
    }
    if (!res.ok) throw new Error(`wwr request failed: ${res.status} ${res.statusText}`);

    const xml = await res.text();
    const parsed = new XMLParser({ ignoreAttributes: true }) // guid parses to plain text
      .parse(xml) as { rss?: { channel?: { item?: WwrRssItem | WwrRssItem[] } } };
    const rawItems = parsed.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    const rows = items.filter(isWwrJobItem).map((item) => normalizeWwrItem(item, source.id));
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;

    this.logger.log(`wwr ingest: fetched ${rows.length}, upserted ${upserted}`);
    return { fetched: rows.length, upserted };
  }
}
