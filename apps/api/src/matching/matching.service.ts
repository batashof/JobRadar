import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { profileMatches, searchProfiles, vacancies } from '../db/schema';
import { diffMatches, scoreMatch, type MatchVacancyInput } from './match-logic';

export interface MatchRunResult {
  profiles: number;
  vacancies: number;
  inserted: number;
  updated: number;
  removed: number;
}

type ProfileRow = typeof searchProfiles.$inferSelect;

type VacancyForMatching = MatchVacancyInput & { id: string };

const INSERT_CHUNK = 500;

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Recomputes matches for every profile. Runs after each ingestion cycle. */
  async rematchAll(): Promise<MatchRunResult> {
    const [profiles, candidates] = await Promise.all([
      this.db.select().from(searchProfiles),
      this.loadCanonicalVacancies(),
    ]);

    const result: MatchRunResult = {
      profiles: profiles.length,
      vacancies: candidates.length,
      inserted: 0,
      updated: 0,
      removed: 0,
    };
    for (const profile of profiles) {
      const { inserted, updated, removed } = await this.reconcile(profile, candidates);
      result.inserted += inserted;
      result.updated += updated;
      result.removed += removed;
    }

    this.logger.log(
      `matching: ${result.profiles} profiles × ${result.vacancies} vacancies → ` +
        `+${result.inserted} ~${result.updated} -${result.removed}`,
    );
    return result;
  }

  /** Recomputes matches for one profile (after profile create/update). */
  async rematchProfile(profileId: string): Promise<void> {
    const profile = await this.db.query.searchProfiles.findFirst({
      where: eq(searchProfiles.id, profileId),
    });
    if (!profile) return;
    await this.reconcile(profile, await this.loadCanonicalVacancies());
  }

  private loadCanonicalVacancies(): Promise<VacancyForMatching[]> {
    // Matching operates on canonical vacancies only (duplicates collapsed).
    return this.db
      .select({
        id: vacancies.id,
        title: vacancies.title,
        description: vacancies.description,
        workFormat: vacancies.workFormat,
        employmentType: vacancies.employmentType,
        salaryMin: vacancies.salaryMin,
        salaryMax: vacancies.salaryMax,
        salaryCurrency: vacancies.salaryCurrency,
      })
      .from(vacancies)
      .where(isNull(vacancies.canonicalVacancyId));
  }

  private async reconcile(
    profile: ProfileRow,
    candidates: VacancyForMatching[],
  ): Promise<{ inserted: number; updated: number; removed: number }> {
    // An inactive profile holds no matches (its rows are cleared, digest
    // history included) — reactivating simply recomputes from scratch.
    const desired = new Map<string, number>();
    if (profile.isActive) {
      for (const vacancy of candidates) {
        const score = scoreMatch(profile, vacancy);
        if (score !== null) desired.set(vacancy.id, score);
      }
    }

    const existingRows = await this.db
      .select({ vacancyId: profileMatches.vacancyId, score: profileMatches.score })
      .from(profileMatches)
      .where(eq(profileMatches.profileId, profile.id));
    const existing = new Map(existingRows.map((r) => [r.vacancyId, r.score]));

    const diff = diffMatches(existing, desired);

    for (let i = 0; i < diff.inserts.length; i += INSERT_CHUNK) {
      const chunk = diff.inserts.slice(i, i + INSERT_CHUNK);
      await this.db
        .insert(profileMatches)
        .values(chunk.map((m) => ({ profileId: profile.id, ...m })))
        .onConflictDoNothing();
    }
    for (const update of diff.updates) {
      await this.db
        .update(profileMatches)
        .set({ score: update.score })
        .where(
          and(
            eq(profileMatches.profileId, profile.id),
            eq(profileMatches.vacancyId, update.vacancyId),
          ),
        );
    }
    for (let i = 0; i < diff.deletes.length; i += INSERT_CHUNK) {
      const chunk = diff.deletes.slice(i, i + INSERT_CHUNK);
      await this.db
        .delete(profileMatches)
        .where(
          and(eq(profileMatches.profileId, profile.id), inArray(profileMatches.vacancyId, chunk)),
        );
    }

    return {
      inserted: diff.inserts.length,
      updated: diff.updates.length,
      removed: diff.deletes.length,
    };
  }
}
