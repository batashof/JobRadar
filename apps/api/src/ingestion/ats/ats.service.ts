import { Inject, Injectable, Logger } from '@nestjs/common';

import { DB, type Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import type { NewVacancy } from '../hh/hh-normalize';
import type { IngestResult } from '../hh/hh.service';
import { upsertVacancies } from '../vacancy-upsert';
import {
  normalizeAshbyJob,
  normalizeGreenhouseJob,
  normalizeLeverJob,
  type AshbyJob,
  type AtsCompany,
  type GreenhouseJob,
  type LeverJob,
} from './ats-normalize';

interface AtsSourceConfig {
  companies?: AtsCompany[];
}

const USER_AGENT = 'JobRadar/0.1 (+https://github.com/batashof/JobRadar; batashof@gmail.com)';

/**
 * A board that has gone away (renamed token, company acquired) must not fail
 * the whole run — the other 30 boards are still good. Only a total wipeout is
 * treated as an error, which the `empty` status already alerts on.
 */
@Injectable()
export class AtsIngestService {
  private readonly logger = new Logger(AtsIngestService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async ingest(source: typeof sources.$inferSelect): Promise<IngestResult> {
    const config = (source.config ?? {}) as AtsSourceConfig;
    const companies = config.companies ?? [];
    if (companies.length === 0) {
      this.logger.warn('ats: no companies configured, skipping');
      return { fetched: 0, upserted: 0 };
    }

    const rows: NewVacancy[] = [];
    const failed: string[] = [];

    for (const company of companies) {
      try {
        // One board at a time: a Greenhouse payload with descriptions can be
        // several megabytes, and the API container has 512 MB (ADR-007).
        rows.push(...(await this.fetchBoard(company, source.id)));
      } catch (error) {
        failed.push(`${company.ats}:${company.token}`);
        this.logger.warn(`ats ${company.ats}:${company.token} failed: ${String(error)}`);
      }
    }

    if (failed.length === companies.length) {
      throw new Error(`ats: every board failed (${failed.length})`);
    }

    const upserted = rows.length > 0 ? await upsertVacancies(this.db, rows) : 0;
    this.logger.log(
      `ats ingest: ${companies.length - failed.length}/${companies.length} boards, ` +
        `fetched ${rows.length}, upserted ${upserted}`,
    );
    return { fetched: rows.length, upserted };
  }

  private async fetchBoard(company: AtsCompany, sourceId: string): Promise<NewVacancy[]> {
    switch (company.ats) {
      case 'greenhouse': {
        const url = `https://boards-api.greenhouse.io/v1/boards/${company.token}/jobs?content=true`;
        const payload = await this.getJson<{ jobs?: GreenhouseJob[] }>(url, company);
        return this.normalizeAll(payload.jobs, (job) =>
          normalizeGreenhouseJob(job, company, sourceId),
        );
      }
      case 'ashby': {
        const url = `https://api.ashbyhq.com/posting-api/job-board/${company.token}?includeCompensation=true`;
        const payload = await this.getJson<{ jobs?: AshbyJob[] }>(url, company);
        return this.normalizeAll(payload.jobs, (job) => normalizeAshbyJob(job, company, sourceId));
      }
      case 'lever': {
        const url = `https://api.lever.co/v0/postings/${company.token}?mode=json`;
        const payload = await this.getJson<LeverJob[]>(url, company);
        return this.normalizeAll(Array.isArray(payload) ? payload : [], (job) =>
          normalizeLeverJob(job, company, sourceId),
        );
      }
    }
  }

  private normalizeAll<T>(
    jobs: T[] | undefined,
    normalize: (job: T) => NewVacancy | null,
  ): NewVacancy[] {
    const rows: NewVacancy[] = [];
    for (const job of jobs ?? []) {
      const row = normalize(job);
      if (row) rows.push(row);
    }
    return rows;
  }

  private async getJson<T>(url: string, company: AtsCompany): Promise<T> {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(`${company.ats}:${company.token} request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
