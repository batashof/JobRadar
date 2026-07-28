/**
 * One-off cleanup for vacancies ingested before the shared description
 * sanitizer existed (ADR-016): re-cleans every board-sourced description
 * (HTML/entity/mojibake repair + boilerplate removal) and deletes the rows that
 * turn out to be pure boilerplate — scraped cookie banners and anti-spam
 * footers that were never vacancies.
 *
 * Idempotent, and conservative: Telegram rows are left alone (their body is the
 * raw post, gated by its own rules), and a row the user already saved (an
 * application or a generated outreach draft) is never deleted.
 *
 * Run with: pnpm --filter @jobradar/api cleanup:junk (DATABASE_URL from the
 * environment / repo-root .env). Pass --prod to run against DATABASE_URL_PROD
 * over Neon HTTPS (this machine blocks TCP 5432), --dry-run to only report.
 */
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { eq, inArray, ne } from 'drizzle-orm';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { cleanDescription, MIN_DESCRIPTION_LENGTH } from '../src/ingestion/description';
import { applications, outreachEmails, sources, vacancies } from '../src/db/schema';

config({ path: '../../.env' });

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

  const [telegram] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.slug, 'telegram'));

  const rows = await db
    .select({ id: vacancies.id, description: vacancies.description })
    .from(vacancies)
    .where(telegram ? ne(vacancies.sourceId, telegram.id) : undefined);

  const protectedIds = new Set<string>([
    ...(await db.select({ id: applications.vacancyId }).from(applications)).map((r) => r.id),
    ...(await db.select({ id: outreachEmails.vacancyId }).from(outreachEmails)).map((r) => r.id),
  ]);

  const junkIds: string[] = [];
  const rewrites: Array<{ id: string; description: string }> = [];

  for (const row of rows) {
    const cleaned = cleanDescription(row.description);
    if (cleaned.length < MIN_DESCRIPTION_LENGTH) {
      if (!protectedIds.has(row.id)) junkIds.push(row.id);
      continue;
    }
    if (cleaned !== row.description) rewrites.push({ id: row.id, description: cleaned });
  }

  console.log(
    `Scanned ${rows.length} board vacancies: ${junkIds.length} junk, ` +
      `${rewrites.length} to re-clean${dryRun ? ' (dry run, nothing written)' : ''}.`,
  );
  if (dryRun) {
    await pool?.end();
    return;
  }

  for (const { id, description } of rewrites) {
    await db.update(vacancies).set({ description }).where(eq(vacancies.id, id));
  }
  // Chunked: profile_matches / resume_matches / hidden_vacancies cascade.
  for (let i = 0; i < junkIds.length; i += 100) {
    await db.delete(vacancies).where(inArray(vacancies.id, junkIds.slice(i, i + 100)));
  }

  console.log(`Deleted ${junkIds.length} junk vacancies, re-cleaned ${rewrites.length}.`);
  await pool?.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
