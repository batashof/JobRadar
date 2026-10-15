import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { vacancies } from '../db/schema';
import { pickDuplicateLinks } from './dedup-logic';

/**
 * Only companies that received a vacancy this recently are re-examined. A pair
 * of older rows was already compared by an earlier run, so a run only has to
 * look at what is new and at the window it can be a duplicate of. A day leaves
 * room for an instance that was down for hours.
 */
export const DEDUP_FRESH_HOURS = 24;

/**
 * Which rows a dedup run reads (ADR-023). It used to read every canonical
 * vacancy, about 17k rows; at one run per 4 hours that was tolerable, at one
 * per 10 minutes it is gigabytes of Supabase egress a month (ADR-001, ADR-019).
 * Now: canonical rows of companies with a fresh vacancy, within twice the
 * window — the farthest an earlier row can be and still pair with a new one.
 */
export function dedupCandidateFilter(windowDays: number, freshHours = DEDUP_FRESH_HOURS): SQL {
  return and(
    isNull(vacancies.canonicalVacancyId),
    sql`${vacancies.ingestedAt} >= now() - make_interval(days => ${windowDays * 2})`,
    sql`${vacancies.companyNormalized} in (
      select distinct v.company_normalized from vacancies v
      where v.ingested_at >= now() - make_interval(hours => ${freshHours})
    )`,
  ) as SQL;
}

export interface DedupResult {
  candidates: number;
  linked: number;
}

@Injectable()
export class DedupService {
  private readonly logger = new Logger(DedupService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async run(): Promise<DedupResult> {
    const threshold = Number(this.config.get('DEDUP_SIMILARITY_THRESHOLD') ?? 0.6);
    const windowDays = Number(this.config.get('DEDUP_WINDOW_DAYS') ?? 14);

    const candidates = await this.db
      .select({
        id: vacancies.id,
        companyNormalized: vacancies.companyNormalized,
        title: vacancies.title,
        publishedAt: vacancies.publishedAt,
        ingestedAt: vacancies.ingestedAt,
      })
      .from(vacancies)
      .where(dedupCandidateFilter(windowDays));

    const links = pickDuplicateLinks(candidates, { windowDays, threshold });
    for (const link of links) {
      await this.db
        .update(vacancies)
        .set({ canonicalVacancyId: link.canonicalId })
        .where(eq(vacancies.id, link.duplicateId));
    }

    this.logger.log(`dedup: ${candidates.length} candidates, ${links.length} linked`);
    return { candidates: candidates.length, linked: links.length };
  }
}
