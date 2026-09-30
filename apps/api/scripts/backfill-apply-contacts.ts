/**
 * One-off backfill: extract apply contacts for vacancies ingested before the
 * extractor existed (ADR-011). Idempotent — only touches rows where
 * apply_contact is null. Run with: pnpm --filter @jobradar/api backfill:contacts
 * (DATABASE_URL from the environment / repo-root .env). Pass --prod to run
 * against DATABASE_URL_PROD (the "DB (prod)" workflow).
 */
import { config } from 'dotenv';
import { eq, isNull } from 'drizzle-orm';

import { openScriptDb } from '../src/db/prod-db';
import { vacancies } from '../src/db/schema';
import { extractApplyContact } from '../src/ingestion/apply-contact';

config({ path: '../../.env' });

async function main(): Promise<void> {
  const prod = process.argv.includes('--prod');
  const { db, close } = openScriptDb(prod);

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
  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
