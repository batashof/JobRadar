import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MatchFeed, MatchProfileOption, MatchQuery } from '@jobradar/shared';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import {
  profileMatches,
  resumeMatches,
  resumes,
  searchProfiles,
  sources,
  vacancies,
} from '../db/schema';

/** Read side of profile matching: serves materialized matches per user. */
@Injectable()
export class MatchesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async feed(userId: string, query: MatchQuery): Promise<MatchFeed> {
    const { profileId, page, pageSize } = query;

    if (profileId) {
      const owned = await this.db.query.searchProfiles.findFirst({
        where: and(eq(searchProfiles.id, profileId), eq(searchProfiles.userId, userId)),
        columns: { id: true },
      });
      if (!owned) throw new NotFoundException('Profile not found');
    }

    const conditions: SQL[] = [
      eq(searchProfiles.userId, userId),
      // Matches are materialized against canonical vacancies, but a vacancy can
      // be linked as a duplicate later — hide such rows until the next rematch.
      isNull(vacancies.canonicalVacancyId),
    ];
    if (profileId) conditions.push(eq(profileMatches.profileId, profileId));
    const where = and(...conditions);

    // LLM resume scores ride along when the user has an active resume (ADR-011).
    const [activeResume] = await this.db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isActive, true)))
      .limit(1);

    const rows = await this.db
      .select({
        profileId: profileMatches.profileId,
        profileName: searchProfiles.name,
        score: profileMatches.score,
        matchedAt: profileMatches.matchedAt,
        resumeScore: resumeMatches.score,
        resumeExplanation: resumeMatches.explanation,
        id: vacancies.id,
        url: vacancies.url,
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: sql<string>`left(${vacancies.description}, 400)`,
        source: sources.slug,
        workFormat: vacancies.workFormat,
        employmentType: vacancies.employmentType,
        salaryMin: vacancies.salaryMin,
        salaryMax: vacancies.salaryMax,
        salaryCurrency: vacancies.salaryCurrency,
        location: vacancies.location,
        publishedAt: vacancies.publishedAt,
      })
      .from(profileMatches)
      .innerJoin(searchProfiles, eq(searchProfiles.id, profileMatches.profileId))
      .innerJoin(vacancies, eq(vacancies.id, profileMatches.vacancyId))
      .innerJoin(sources, eq(sources.id, vacancies.sourceId))
      .leftJoin(
        resumeMatches,
        and(
          eq(resumeMatches.vacancyId, vacancies.id),
          eq(resumeMatches.resumeId, activeResume?.id ?? '00000000-0000-0000-0000-000000000000'),
        ),
      )
      .where(where)
      .orderBy(
        desc(profileMatches.score),
        sql`${vacancies.publishedAt} desc nulls last`,
        desc(profileMatches.matchedAt),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // Same joins as above: `where` references profiles and vacancies.
    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(profileMatches)
      .innerJoin(searchProfiles, eq(searchProfiles.id, profileMatches.profileId))
      .innerJoin(vacancies, eq(vacancies.id, profileMatches.vacancyId))
      .where(where);

    return {
      items: rows.map((r) => ({
        profileId: r.profileId,
        profileName: r.profileName,
        score: r.score,
        matchedAt: r.matchedAt.toISOString(),
        resumeScore: r.resumeScore ?? null,
        resumeExplanation: r.resumeExplanation || null,
        vacancy: {
          id: r.id,
          url: r.url,
          title: r.title,
          company: r.company,
          description: r.description,
          source: r.source,
          workFormat: r.workFormat,
          employmentType: r.employmentType,
          salaryMin: r.salaryMin,
          salaryMax: r.salaryMax,
          salaryCurrency: r.salaryCurrency,
          location: r.location,
          publishedAt: r.publishedAt?.toISOString() ?? null,
        },
      })),
      total: countRow?.count ?? 0,
      page,
      pageSize,
    };
  }

  /** The user's profiles as filter options, with current match counts. */
  async listProfileOptions(userId: string): Promise<MatchProfileOption[]> {
    return this.db
      .select({
        id: searchProfiles.id,
        name: searchProfiles.name,
        isActive: searchProfiles.isActive,
        count: sql<number>`count(${profileMatches.vacancyId})::int`,
      })
      .from(searchProfiles)
      .leftJoin(profileMatches, eq(profileMatches.profileId, searchProfiles.id))
      .where(eq(searchProfiles.userId, userId))
      .groupBy(searchProfiles.id)
      .orderBy(desc(searchProfiles.createdAt));
  }
}
