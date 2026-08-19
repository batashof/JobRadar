/**
 * Relabels `vacancies.seniority` with the current classifier (ADR-012).
 *
 * It used to only fill rows where the level was null, because the assumption
 * was that a stored level is a correct level. It was not: classifying from the
 * whole posting text made prose ("you will lead the team") look like a level
 * and mislabelled 45% of the board as `lead`. So this now re-derives **every**
 * row, writing only where the answer actually changed. Still idempotent — a
 * second run reports zero changes — and safe to re-run after any change to the
 * detector.
 *
 * Run with: pnpm --filter @jobradar/api backfill:seniority (DATABASE_URL from
 * the environment / repo-root .env). Pass --prod to run against
 * DATABASE_URL_PROD over Neon HTTPS (this machine blocks TCP 5432), and
 * --dry-run to print the change summary without writing anything.
 */
import { neon } from '@neondatabase/serverless';
import { detectVacancySeniority, type SeniorityLevel } from '@jobradar/shared';
import { config } from 'dotenv';
import { inArray } from 'drizzle-orm';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { vacancies } from '../src/db/schema';

config({ path: '../../.env' });

/** Ids per write, so a full relabel is a handful of statements, not thousands. */
const UPDATE_CHUNK = 500;

async function main(): Promise<void> {
  const prod = process.argv.includes('--prod');
  const dryRun = process.argv.includes('--dry-run');
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
    .select({
      id: vacancies.id,
      title: vacancies.title,
      description: vacancies.description,
      seniority: vacancies.seniority,
    })
    .from(vacancies);

  // Grouped by the level to write, so each group is one statement per chunk.
  const byLevel = new Map<SeniorityLevel | null, string[]>();
  const transitions = new Map<string, number>();

  for (const row of rows) {
    const level = detectVacancySeniority(row.title, row.description);
    if (level === (row.seniority ?? null)) continue;
    byLevel.set(level, [...(byLevel.get(level) ?? []), row.id]);
    const key = `${row.seniority ?? '(none)'} → ${level ?? '(none)'}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
  }

  const changed = [...byLevel.values()].reduce((sum, ids) => sum + ids.length, 0);
  console.log(`Scanned ${rows.length} vacancies; ${changed} would change.`);
  for (const [key, count] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    await pool?.end();
    return;
  }

  for (const [level, ids] of byLevel) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      await db
        .update(vacancies)
        .set({ seniority: level })
        .where(inArray(vacancies.id, ids.slice(i, i + UPDATE_CHUNK)));
    }
  }

  console.log(`\nRelabelled ${changed} vacancies.`);
  await pool?.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
