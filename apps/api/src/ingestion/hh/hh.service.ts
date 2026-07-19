import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../../db/db.module';
import { searchProfiles, type sources } from '../../db/schema';
import { upsertVacancies } from '../vacancy-upsert';
import { normalizeHhItem, type HhVacancyItem, type NewVacancy } from './hh-normalize';

export interface IngestResult {
  fetched: number;
  upserted: number;
  /** Conditional GET said nothing changed — not an alerting "empty" run. */
  notModified?: boolean;
}

interface HhSearchResponse {
  items: HhVacancyItem[];
  pages: number;
  page: number;
}

interface HhSourceConfig {
  baseUrl?: string;
  endpoint?: string;
  maxPages?: number;
  perPage?: number;
  pageDelayMs?: number;
}

/** Honest User-Agent per docs/DATA_SOURCES.md politeness rules. */
const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

/**
 * hh.ru returns geo-403 for anonymous requests from many non-CIS/datacenter
 * IPs; an application token (dev.hh.ru) lifts that. Optional by design.
 */
export function hhRequestHeaders(appToken?: string): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    'HH-User-Agent': USER_AGENT,
    ...(appToken ? { Authorization: `Bearer ${appToken}` } : {}),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class HhIngestService {
  private readonly logger = new Logger(HhIngestService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as HhSourceConfig;
    const baseUrl = config.baseUrl ?? 'https://api.hh.ru';
    const endpoint = config.endpoint ?? '/vacancies';
    const maxPages = config.maxPages ?? 3;
    const perPage = config.perPage ?? 100;
    const pageDelayMs = config.pageDelayMs ?? 300;

    const profiles = await this.db
      .select()
      .from(searchProfiles)
      .where(eq(searchProfiles.isActive, true));
    if (profiles.length === 0) {
      this.logger.warn('No active search profiles — nothing to query hh for');
      return { fetched: 0, upserted: 0 };
    }

    // One hh query per profile; results are merged by external id.
    const byExternalId = new Map<string, NewVacancy>();
    for (const profile of profiles) {
      if (profile.keywords.length === 0) continue;
      const text = profile.keywords.join(' OR ');
      const remoteOnly = profile.workFormat.length === 1 && profile.workFormat[0] === 'remote';

      for (let page = 0; page < maxPages; page++) {
        const url = new URL(baseUrl + endpoint);
        url.searchParams.set('text', text);
        url.searchParams.set('per_page', String(perPage));
        url.searchParams.set('page', String(page));
        if (remoteOnly) url.searchParams.set('schedule', 'remote');

        const data = await this.fetchPage(url);
        for (const item of data.items) {
          byExternalId.set(String(item.id), normalizeHhItem(item, source.id));
        }
        if (page >= data.pages - 1) break;
        await sleep(pageDelayMs);
      }
    }

    const rows = [...byExternalId.values()];
    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;

    this.logger.log(`hh ingest: fetched ${byExternalId.size}, upserted ${upserted}`);
    return { fetched: byExternalId.size, upserted };
  }

  private async fetchPage(url: URL): Promise<HhSearchResponse> {
    const res = await fetch(url, {
      headers: hhRequestHeaders(this.config.get<string>('HH_API_TOKEN')),
    });
    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') ?? 'unknown';
      throw new Error(`hh rate limited (429), Retry-After: ${retryAfter}`);
    }
    if (!res.ok) {
      throw new Error(`hh request failed: ${res.status} ${res.statusText} for ${url.pathname}`);
    }
    return (await res.json()) as HhSearchResponse;
  }
}
