import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, isNull } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { vacancies } from '../db/schema';
import { pickDuplicateLinks } from './dedup-logic';

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
      .where(isNull(vacancies.canonicalVacancyId));

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
