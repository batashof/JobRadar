import { Inject, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import { isWwrJobItem, normalizeWwrItem, type WwrRssItem } from './wwr-normalize';

interface WwrSourceConfig {
  /** Legacy single-feed config; `feedUrls` supersedes it. */
  feedUrl?: string;
  feedUrls?: string[];
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

const DEFAULT_FEED_URLS = ['https://weworkremotely.com/categories/remote-programming-jobs.rss'];

@Injectable()
export class WwrIngestService {
  private readonly logger = new Logger(WwrIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as WwrSourceConfig;
    const feedUrls = config.feedUrls?.length
      ? config.feedUrls
      : config.feedUrl
        ? [config.feedUrl]
        : DEFAULT_FEED_URLS;

    // Conditional GET per docs/DATA_SOURCES.md politeness rules.
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (source.lastRunAt) headers['If-Modified-Since'] = source.lastRunAt.toUTCString();

    // The category feeds overlap (a full-stack role is also listed under
    // programming), so dedupe by external id before hitting the database.
    const byExternalId = new Map<string, ReturnType<typeof normalizeWwrItem>>();
    let notModifiedCount = 0;

    for (const feedUrl of feedUrls) {
      const res = await fetch(feedUrl, { headers });
      if (res.status === 304) {
        notModifiedCount += 1;
        continue;
      }
      if (!res.ok) throw new Error(`wwr request failed: ${res.status} ${res.statusText}`);

      const xml = await res.text();
      const parsed = new XMLParser({ ignoreAttributes: true }) // guid parses to plain text
        .parse(xml) as { rss?: { channel?: { item?: WwrRssItem | WwrRssItem[] } } };
      const rawItems = parsed.rss?.channel?.item;
      const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

      for (const item of items.filter(isWwrJobItem)) {
        const row = normalizeWwrItem(item, source.id);
        byExternalId.set(row.externalId, row);
      }
    }

    // Only a run where *every* feed reported 304 is a genuine no-op; a partial
    // one still has fresh rows and must not be reported as unchanged.
    if (notModifiedCount === feedUrls.length) {
      this.logger.log('wwr feeds not modified since last run');
      return { fetched: 0, upserted: 0, notModified: true };
    }

    const rows = [...byExternalId.values()];
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;

    this.logger.log(
      `wwr ingest: ${feedUrls.length} feed(s), fetched ${rows.length}, upserted ${upserted}`,
    );
    return { fetched: rows.length, upserted };
  }
}
