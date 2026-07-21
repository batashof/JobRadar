import { sql } from 'drizzle-orm';
import { detectSeniority } from '@jobradar/shared';

import type { Database } from '../db/db.module';
import { vacancies } from '../db/schema';
import { extractApplyContact } from './apply-contact';
import type { NewVacancy } from './hh/hh-normalize';

/** Chunked upsert keyed on (source_id, external_id); refreshes mutable fields. */
export async function upsertVacancies(db: Database, rows: NewVacancy[]): Promise<number> {
  // Contact extraction and seniority classification happen here — the single
  // choke point every source funnels through (ADR-011 / ADR-012).
  const enriched = rows.map((row) => {
    const text = `${row.title}\n${row.description ?? ''}`;
    return {
      ...row,
      applyContact: extractApplyContact(text),
      seniority: detectSeniority(text),
    };
  });
  let upserted = 0;
  for (let i = 0; i < enriched.length; i += 100) {
    const chunk = enriched.slice(i, i + 100);
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
          applyContact: sql`excluded.apply_contact`,
          seniority: sql`excluded.seniority`,
        },
      });
    upserted += chunk.length;
  }
  return upserted;
}
