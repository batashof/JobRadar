import { Inject, Injectable, Logger } from '@nestjs/common';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import { isHnJobComment, normalizeHnComment, type HnComment } from './hn-normalize';

interface HnSourceConfig {
  apiBaseUrl?: string;
  /** How many recent monthly threads to walk (1 = the current month only). */
  threads?: number;
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

const DEFAULT_API = 'https://hn.algolia.com/api/v1';
const DEFAULT_THREADS = 2;
/** Algolia's per-page cap; the thread has ~400-600 comments. */
const PAGE_SIZE = 100;
/** Safety stop: a runaway `nbPages` must not turn into unbounded requests. */
const MAX_PAGES = 10;

interface AlgoliaStory {
  objectID?: string;
  title?: string;
}

@Injectable()
export class HnIngestService {
  private readonly logger = new Logger(HnIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as HnSourceConfig;
    const api = config.apiBaseUrl ?? DEFAULT_API;
    const threadCount = config.threads ?? DEFAULT_THREADS;

    const storyIds = await this.findHiringThreads(api, threadCount);
    if (storyIds.length === 0) {
      this.logger.warn('hn: no "Who is hiring?" thread found');
      return { fetched: 0, upserted: 0 };
    }

    const rows = new Map<string, ReturnType<typeof normalizeHnComment>>();
    for (const storyId of storyIds) {
      for (const comment of await this.fetchComments(api, storyId)) {
        if (!isHnJobComment(comment, storyId)) continue;
        const row = normalizeHnComment(comment, source.id);
        if (row) rows.set(row.externalId, row);
      }
    }

    const values = [...rows.values()].filter((row) => row !== null);
    const upserted = values.length > 0 ? await upsertVacancies(this.db, values) : 0;

    this.logger.log(
      `hn ingest: ${storyIds.length} thread(s), fetched ${values.length}, upserted ${upserted}`,
    );
    return { fetched: values.length, upserted };
  }

  /**
   * The threads are posted monthly by the `whoishiring` bot account. The same
   * account also posts "Who wants to be hired?" (candidates, not vacancies) and
   * "Freelancer? Seeking freelancer?", so the title has to be matched.
   */
  private async findHiringThreads(api: string, count: number): Promise<number[]> {
    const url = `${api}/search_by_date?tags=story,author_whoishiring&hitsPerPage=20`;
    const payload = await this.getJson<{ hits?: AlgoliaStory[] }>(url);
    return (payload.hits ?? [])
      .filter((hit) => /who\s+is\s+hiring/i.test(hit.title ?? ''))
      .map((hit) => Number(hit.objectID))
      .filter((id) => Number.isFinite(id))
      .slice(0, count);
  }

  private async fetchComments(api: string, storyId: number): Promise<HnComment[]> {
    const comments: HnComment[] = [];
    let pages = 1;
    for (let page = 0; page < Math.min(pages, MAX_PAGES); page += 1) {
      const url = `${api}/search?tags=comment,story_${storyId}&hitsPerPage=${PAGE_SIZE}&page=${page}`;
      const payload = await this.getJson<{ hits?: HnComment[]; nbPages?: number }>(url);
      comments.push(...(payload.hits ?? []));
      pages = payload.nbPages ?? 1;
      if ((payload.hits ?? []).length === 0) break;
    }
    return comments;
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`hn request failed: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }
}
