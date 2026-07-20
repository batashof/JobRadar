import { Inject, Injectable } from '@nestjs/common';
import type { VacancyFeed, VacancyQuery } from '@jobradar/shared';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { sources, vacancies } from '../db/schema';

@Injectable()
export class VacanciesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async feed(query: VacancyQuery): Promise<VacancyFeed> {
    const { q, workFormat, employmentType, salaryMin, page, pageSize } = query;

    // Feed operates on canonical vacancies only (duplicates are collapsed).
    const conditions: SQL[] = [isNull(vacancies.canonicalVacancyId)];

    const tsQuery = q ? sql`websearch_to_tsquery('simple', ${q})` : null;
    if (tsQuery) conditions.push(sql`${vacancies.searchVector} @@ ${tsQuery}`);
    if (workFormat.length) conditions.push(inArray(vacancies.workFormat, workFormat));
    if (employmentType.length) conditions.push(inArray(vacancies.employmentType, employmentType));
    if (salaryMin != null) {
      conditions.push(
        sql`(${vacancies.salaryMax} >= ${salaryMin} or ${vacancies.salaryMin} >= ${salaryMin})`,
      );
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
      })
      .from(vacancies)
      .innerJoin(sources, eq(sources.id, vacancies.sourceId))
      .where(where)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(vacancies)
      .where(where);

    return {
      items: items.map((v) => ({ ...v, publishedAt: v.publishedAt?.toISOString() ?? null })),
      total: countRow?.count ?? 0,
      page,
      pageSize,
    };
  }
}
