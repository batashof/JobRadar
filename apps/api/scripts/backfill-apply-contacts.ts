/**
 * One-off backfill: extract apply contacts for vacancies ingested before the
 * extractor existed (ADR-011). Idempotent — only touches rows where
 * apply_contact is null. Run with: pnpm --filter @jobradar/api backfill:contacts
 * (DATABASE_URL from the environment / repo-root .env).
 */
import { config } from 'dotenv';
import { eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { vacancies } from '../src/db/schema';
import { extractApplyContact } from '../src/ingestion/apply-contact';

config({ path: '../../.env' });

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const rows = await db
    .select({ id: vacancies.id, title: vacancies.title, description: vacancies.description })
    .from(vacancies)
    .where(isNull(vacancies.applyContact));

  let updated = 0;
  for (const row of rows) {
    const contact = extractApplyContact(`${row.title}\n${row.description}`);
    if (!contact) continue;
    await db.update(vacancies).set({ applyContact: contact }).where(eq(vacancies.id, row.id));
    updated += 1;
  }

  console.log(`Scanned ${rows.length} vacancies without a contact; extracted ${updated}.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
