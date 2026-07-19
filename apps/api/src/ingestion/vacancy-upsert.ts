import { sql } from 'drizzle-orm';

import type { Database } from '../db/db.module';
import { vacancies } from '../db/schema';
import type { NewVacancy } from './hh/hh-normalize';

/** Chunked upsert keyed on (source_id, external_id); refreshes mutable fields. */
export async function upsertVacancies(db: Database, rows: NewVacancy[]): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await db
      .insert(vacancies)
      .values(chunk)
      .onConflictDoUpdate({
        target: [vacancies.sourceId, vacancies.externalId],
        set: {
          url: sql`excluded.url`,
          title: sql`excluded.title`,
          companyRaw: sql`excluded.company_raw`,
          companyNormalized: sql`excluded.company_normalized`,
          description: sql`excluded.description`,
          workFormat: sql`excluded.work_format`,
          employmentType: sql`excluded.employment_type`,
          salaryMin: sql`excluded.salary_min`,
          salaryMax: sql`excluded.salary_max`,
          salaryCurrency: sql`excluded.salary_currency`,
          location: sql`excluded.location`,
          publishedAt: sql`excluded.published_at`,
        },
      });
    upserted += chunk.length;
  }
  return upserted;
}
