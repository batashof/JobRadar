import { Inject, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { NewVacancy } from '../hh/hh-normalize';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import {
  DEFAULT_DJINNI_KEYWORDS,
  DEFAULT_DOU_CATEGORIES,
  normalizeDjinniItem,
  normalizeDouItem,
  type UaRssItem,
} from './ua-boards-normalize';

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

interface DouConfig {
  categories?: string[];
}

interface DjinniConfig {
  keywords?: string[];
}

interface Board {
  name: string;
  feeds: string[];
  normalize: (item: UaRssItem, sourceId: string) => NewVacancy | null;
}

/**
 * One worker for both boards: a list of feeds, fetched one after another,
 * deduplicated by posting id (a React role sits in the JavaScript and the
 * TypeScript feeds alike). A feed that fails is skipped; only a run where every
 * feed fails is an error, which the `empty` / `error` status alerts on.
 */
@Injectable()
export class UaBoardsIngestService {
  private readonly logger = new Logger(UaBoardsIngestService.name);
  private readonly parser = new XMLParser({ ignoreAttributes: true });

  constructor(@Inject(DB) private readonly db: Database) {}

  ingestDou(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const categories = (source.config as DouConfig | null)?.categories ?? DEFAULT_DOU_CATEGORIES;
    return this.ingest(source, {
      name: 'dou',
      feeds: categories.map(
        (category) =>
          `https://jobs.dou.ua/vacancies/feeds/?category=${encodeURIComponent(category)}`,
      ),
      normalize: normalizeDouItem,
    });
  }

  ingestDjinni(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const keywords = (source.config as DjinniConfig | null)?.keywords ?? DEFAULT_DJINNI_KEYWORDS;
    return this.ingest(source, {
      name: 'djinni',
      feeds: keywords.map(
        (keyword) => `https://djinni.co/jobs/rss/?primary_keyword=${encodeURIComponent(keyword)}`,
      ),
      normalize: normalizeDjinniItem,
    });
  }

  private async ingest(source: typeof sources.$inferSelect, board: Board): Promise<IngestResult> {
    const byId = new Map<string, NewVacancy>();
    let failed = 0;

    for (const feed of board.feeds) {
      try {
        for (const item of await this.fetchItems(feed)) {
          const row = board.normalize(item, source.id);
          if (row) byId.set(row.externalId, row);
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(`${board.name} feed ${feed} failed: ${String(error)}`);
      }
    }

    if (board.feeds.length > 0 && failed === board.feeds.length) {
      throw new Error(`${board.name}: every feed failed (${failed})`);
    }

    const rows = [...byId.values()];
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;
    this.logger.log(
      `${board.name} ingest: ${board.feeds.length - failed}/${board.feeds.length} feeds, ` +
        `fetched ${rows.length}, upserted ${upserted}`,
    );
    return { fetched: rows.length, upserted };
  }

  private async fetchItems(url: string): Promise<UaRssItem[]> {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`request failed: ${res.status}`);
    const parsed = this.parser.parse(await res.text()) as {
      rss?: { channel?: { item?: UaRssItem | UaRssItem[] } };
    };
    const items = parsed.rss?.channel?.item;
    return Array.isArray(items) ? items : items ? [items] : [];
  }
}
