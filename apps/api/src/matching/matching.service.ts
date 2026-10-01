import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

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

  /**
   * Brings every profile's matches up to date. Runs after each ingestion cycle.
   *
   * This used to re-read every canonical vacancy — description included — on
   * every run, whether or not a single profile existed to match against. Six
   * runs a day over a board of thousands of postings is gigabytes a month of
   * database egress, which is exactly the budget Neon's free tier caps (ADR-001)
   * and exactly what exhausted it in September 2026. Now a run reads only what
   * it has to:
   *
   * - no active profile → no vacancy is read at all;
   * - a profile that has been matched before → only vacancies whose matched
   *   content changed since (`content_changed_at` past its `matched_through`);
   * - a profile never matched, or edited since → the full pass, once.
   *
   * Scoring is a pure function of (profile, vacancy), so matching the delta
   * gives the same result as re-matching everything, provided the rows that
   * left the canonical set are dropped too — `pruneDuplicates` does that in SQL.
   */
  async rematchAll(): Promise<MatchRunResult> {
    const profiles = await this.db.select().from(searchProfiles);
    const result: MatchRunResult = {
      profiles: profiles.length,
      vacancies: 0,
      inserted: 0,
      updated: 0,
      removed: 0,
    };

    // An inactive profile holds no matches; reactivating recomputes from scratch.
    const inactive = profiles.filter((p) => !p.isActive).map((p) => p.id);
    if (inactive.length > 0) result.removed += await this.clearProfiles(inactive);

    const active = profiles.filter((p) => p.isActive);
    if (active.length > 0) {
      result.removed += await this.pruneDuplicates(active.map((p) => p.id));
      const until = await this.contentHighWater();
      for (const profile of active) {
        if (until === null) break;
        const counts = await this.matchThrough(profile, until);
        result.vacancies += counts.read;
        result.inserted += counts.inserted;
        result.updated += counts.updated;
        result.removed += counts.removed;
      }
    }

    this.logger.log(
      `matching: ${result.profiles} profiles, ${result.vacancies} vacancies read → ` +
        `+${result.inserted} ~${result.updated} -${result.removed}`,
    );
    return result;
  }

  /** Recomputes matches for one profile from scratch (after profile create/update). */
  async rematchProfile(profileId: string): Promise<void> {
    const profile = await this.db.query.searchProfiles.findFirst({
      where: eq(searchProfiles.id, profileId),
    });
    if (!profile) return;

    if (!profile.isActive) {
      await this.clearProfiles([profile.id]);
      return;
    }
    const until = await this.contentHighWater();
    if (until === null) return;
    // The criteria changed, so what was matched before says nothing any more.
    await this.matchThrough({ ...profile, matchedThrough: null }, until);
  }

  /**
   * Matches one profile against the vacancies it has not seen, up to `until`,
   * and moves its watermark there. The upper bound is read before the rows, so
   * a posting that lands mid-run is left for the next run rather than skipped.
   */
  private async matchThrough(
    profile: ProfileRow,
    until: string,
  ): Promise<{ read: number; inserted: number; updated: number; removed: number }> {
    const full = profile.matchedThrough === null;
    const candidates = await this.loadCanonicalVacancies(profile.matchedThrough, until);
    const counts = await this.reconcile(
      profile,
      candidates,
      full ? null : candidates.map((c) => c.id),
    );
    await this.db
      .update(searchProfiles)
      .set({ matchedThrough: sql`${until}::timestamptz` })
      .where(eq(searchProfiles.id, profile.id));
    return { read: candidates.length, ...counts };
  }

  /**
   * The latest content change on the canonical board, as Postgres text so the
   * microseconds survive the round trip into `matched_through`. Null = no
   * vacancies at all.
   */
  private async contentHighWater(): Promise<string | null> {
    const [row] = await this.db
      .select({ at: sql<string | null>`max(${vacancies.contentChangedAt})::text` })
      .from(vacancies)
      .where(isNull(vacancies.canonicalVacancyId));
    return row?.at ?? null;
  }

  private loadCanonicalVacancies(
    after: string | null,
    until: string,
  ): Promise<VacancyForMatching[]> {
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
      .where(
        and(
          isNull(vacancies.canonicalVacancyId),
          sql`${vacancies.contentChangedAt} <= ${until}::timestamptz`,
          after === null ? undefined : sql`${vacancies.contentChangedAt} > ${after}::timestamptz`,
        ),
      );
  }

  /**
   * Drops every match of the given profiles and forgets their watermark, so
   * however a profile comes back to life it gets the full pass, not a delta
   * over matches it no longer has. Returns how many rows went.
   */
  private async clearProfiles(profileIds: string[]): Promise<number> {
    const removed = await this.db
      .delete(profileMatches)
      .where(inArray(profileMatches.profileId, profileIds))
      .returning({ vacancyId: profileMatches.vacancyId });
    await this.db
      .update(searchProfiles)
      .set({ matchedThrough: null })
      .where(inArray(searchProfiles.id, profileIds));
    return removed.length;
  }

  /**
   * Dedup links a vacancy to its canonical twin after it may already have been
   * matched. A delta run never re-reads that row, so its match is removed here,
   * in one statement, without pulling anything over the wire.
   */
  private async pruneDuplicates(profileIds: string[]): Promise<number> {
    const removed = await this.db
      .delete(profileMatches)
      .where(
        and(
          inArray(profileMatches.profileId, profileIds),
          inArray(
            profileMatches.vacancyId,
            this.db
              .select({ id: vacancies.id })
              .from(vacancies)
              .where(isNotNull(vacancies.canonicalVacancyId)),
          ),
        ),
      )
      .returning({ vacancyId: profileMatches.vacancyId });
    return removed.length;
  }

  /**
   * Writes the difference between the stored matches and the scored
   * `candidates`. `scope` limits the comparison to those vacancy ids — a delta
   * run must not read "absent from this batch" as "no longer a match". Null
   * compares against everything the profile holds (the full pass).
   */
  private async reconcile(
    profile: ProfileRow,
    candidates: VacancyForMatching[],
    scope: string[] | null,
  ): Promise<{ inserted: number; updated: number; removed: number }> {
    if (scope !== null && scope.length === 0) return { inserted: 0, updated: 0, removed: 0 };

    const desired = new Map<string, number>();
    for (const vacancy of candidates) {
      const score = scoreMatch(profile, vacancy);
      if (score !== null) desired.set(vacancy.id, score);
    }

    const existingRows = await this.db
      .select({ vacancyId: profileMatches.vacancyId, score: profileMatches.score })
      .from(profileMatches)
      .where(
        and(
          eq(profileMatches.profileId, profile.id),
          scope === null ? undefined : inArray(profileMatches.vacancyId, scope),
        ),
      );
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
