/**
 * One-off backfill: classify seniority for vacancies ingested before the
 * detector existed (ADR-012). Idempotent — only touches rows where seniority is
 * null. Run with: pnpm --filter @jobradar/api backfill:seniority (DATABASE_URL
 * from the environment / repo-root .env). Pass --prod to run against
 * DATABASE_URL_PROD over Neon HTTPS (this machine blocks TCP 5432).
 */
import { neon } from '@neondatabase/serverless';
import { detectSeniority } from '@jobradar/shared';
import { config } from 'dotenv';
import { eq, isNull } from 'drizzle-orm';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { vacancies } from '../src/db/schema';

config({ path: '../../.env' });

async function main(): Promise<void> {
  const prod = process.argv.includes('--prod');
  let pool: Pool | null = null;
  let db;
  if (prod) {
    const url = process.env.DATABASE_URL_PROD;
    if (!url) throw new Error('DATABASE_URL_PROD is not set (see .env)');
    db = drizzleNeon(neon(url));
  } else {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool);
  }

  const rows = await db
    .select({ id: vacancies.id, title: vacancies.title, description: vacancies.description })
    .from(vacancies)
    .where(isNull(vacancies.seniority));

  let updated = 0;
  for (const row of rows) {
    const level = detectSeniority(`${row.title}\n${row.description}`);
    if (!level) continue;
    await db.update(vacancies).set({ seniority: level }).where(eq(vacancies.id, row.id));
    updated += 1;
  }

  console.log(`Scanned ${rows.length} vacancies without a level; classified ${updated}.`);
  await pool?.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
