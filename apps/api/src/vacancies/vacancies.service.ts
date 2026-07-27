import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ApplyContact,
  detectSeniority,
  type Language,
  levelsBelowResume,
  type SeniorityLevel,
  type SourceOption,
  type VacancyDetail,
  type VacancyFeed,
  type VacancyQuery,
} from '@jobradar/shared';
import { and, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { resumeMatches, resumes, sources, vacancies } from '../db/schema';

// Placeholder id for the resume-match left join when the user has no active
// resume — matches nothing, so every resumeScore comes back null.
const NO_RESUME = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class VacanciesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async feed(userId: string, lang: Language, query: VacancyQuery): Promise<VacancyFeed> {
    const { q, workFormat, employmentType, salaryMin, resumeFit, page, pageSize } = query;

    const resume = await this.activeResume(userId);

    // Feed operates on canonical vacancies only (duplicates are collapsed).
    const conditions: SQL[] = [isNull(vacancies.canonicalVacancyId)];

    const tsQuery = q ? sql`websearch_to_tsquery('simple', ${q})` : null;
    if (tsQuery) conditions.push(sql`${vacancies.searchVector} @@ ${tsQuery}`);
    if (workFormat.length) conditions.push(inArray(vacancies.workFormat, workFormat));
    if (employmentType.length) conditions.push(inArray(vacancies.employmentType, employmentType));
    if (query.sources.length) conditions.push(inArray(sources.slug, query.sources));
    if (salaryMin != null) {
      conditions.push(
        sql`(${vacancies.salaryMax} >= ${salaryMin} or ${vacancies.salaryMin} >= ${salaryMin})`,
      );
    }

    // Soft resume-level filter (ADR-012): drop vacancies two or more grades
    // below the resume. Rows with an unknown level always pass, so the feed
    // never over-empties.
    const resumeLevel = resume ? detectSeniority(resume.text) : null;
    if (resumeFit && resumeLevel) {
      const tooJunior = levelsBelowResume(resumeLevel);
      if (tooJunior.length > 0) {
        const clause = or(isNull(vacancies.seniority), notInArray(vacancies.seniority, tooJunior));
        if (clause) conditions.push(clause);
      }
    }

    const where = and(...conditions);
    const orderBy = tsQuery
      ? sql`ts_rank(${vacancies.searchVector}, ${tsQuery}) desc, ${vacancies.publishedAt} desc nulls last`
      : sql`${vacancies.publishedAt} desc nulls last, ${vacancies.ingestedAt} desc`;

    const items = await this.db
      .select({
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
        seniority: vacancies.seniority,
        resumeScore: resumeMatches.score,
        resumeExplanation: resumeMatches.explanation,
        resumeExplanationEn: resumeMatches.explanationEn,
      })
      .from(vacancies)
      .innerJoin(sources, eq(sources.id, vacancies.sourceId))
      .leftJoin(
        resumeMatches,
        and(
          eq(resumeMatches.vacancyId, vacancies.id),
          eq(resumeMatches.resumeId, resume?.id ?? NO_RESUME),
        ),
      )
      .where(where)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // Same join as above: `where` may reference sources.slug.
    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(vacancies)
      .innerJoin(sources, eq(sources.id, vacancies.sourceId))
      .where(where);

    return {
      items: items.map(({ resumeExplanationEn, ...v }) => ({
        ...v,
        seniority: (v.seniority as SeniorityLevel | null) ?? null,
        resumeScore: v.resumeScore ?? null,
        resumeExplanation: (lang === 'en' ? resumeExplanationEn : v.resumeExplanation) || null,
        publishedAt: v.publishedAt?.toISOString() ?? null,
      })),
      total: countRow?.count ?? 0,
      page,
      pageSize,
    };
  }

  /** Full vacancy for the in-app detail page (ADR-011); carries the cached resume score. */
  async getById(userId: string, lang: Language, id: string): Promise<VacancyDetail> {
    const resume = await this.activeResume(userId);

    const [row] = await this.db
      .select({
        id: vacancies.id,
        url: vacancies.url,
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
        source: sources.slug,
        workFormat: vacancies.workFormat,
        employmentType: vacancies.employmentType,
        salaryMin: vacancies.salaryMin,
        salaryMax: vacancies.salaryMax,
        salaryCurrency: vacancies.salaryCurrency,
        location: vacancies.location,
        publishedAt: vacancies.publishedAt,
        seniority: vacancies.seniority,
        applyContact: vacancies.applyContact,
        summaryRu: vacancies.summaryRu,
        summaryEn: vacancies.summaryEn,
        ingestedAt: vacancies.ingestedAt,
        resumeScore: resumeMatches.score,
        resumeExplanation: resumeMatches.explanation,
        resumeExplanationEn: resumeMatches.explanationEn,
        resumeBreakdown: resumeMatches.breakdown,
        resumeBreakdownEn: resumeMatches.breakdownEn,
      })
      .from(vacancies)
      .innerJoin(sources, eq(sources.id, vacancies.sourceId))
      .leftJoin(
        resumeMatches,
        and(
          eq(resumeMatches.vacancyId, vacancies.id),
          eq(resumeMatches.resumeId, resume?.id ?? NO_RESUME),
        ),
      )
      .where(eq(vacancies.id, id));
    if (!row) throw new NotFoundException('Vacancy not found');

    const { summaryRu, summaryEn, resumeExplanationEn, resumeBreakdownEn, ...rest } = row;
    return {
      ...rest,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      ingestedAt: row.ingestedAt.toISOString(),
      seniority: (row.seniority as SeniorityLevel | null) ?? null,
      applyContact: (row.applyContact as ApplyContact | null) ?? null,
      summary: (lang === 'en' ? summaryEn : summaryRu) ?? null,
      resumeScore: row.resumeScore ?? null,
      resumeExplanation: (lang === 'en' ? resumeExplanationEn : row.resumeExplanation) || null,
      resumeBreakdown: (lang === 'en' ? resumeBreakdownEn : row.resumeBreakdown) ?? null,
    };
  }

  /** Filter options: sources that actually have canonical vacancies, busiest first. */
  async listSources(): Promise<SourceOption[]> {
    return this.db
      .select({ slug: sources.slug, count: sql<number>`count(*)::int` })
      .from(vacancies)
      .innerJoin(sources, eq(sources.id, vacancies.sourceId))
      .where(isNull(vacancies.canonicalVacancyId))
      .groupBy(sources.slug)
      .orderBy(desc(sql`count(*)`), sources.slug);
  }

  /** The caller's active resume (id + extracted text), or null. */
  private async activeResume(userId: string): Promise<{ id: string; text: string } | null> {
    const [row] = await this.db
      .select({ id: resumes.id, text: resumes.extractedText })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isActive, true)))
      .orderBy(desc(resumes.uploadedAt))
      .limit(1);
    return row ?? null;
  }
}
