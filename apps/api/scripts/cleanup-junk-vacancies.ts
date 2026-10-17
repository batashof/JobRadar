/**
 * One-off cleanup for vacancies ingested before the shared description
 * sanitizer existed (ADR-016): re-cleans every board-sourced description
 * (HTML/entity/mojibake repair + boilerplate removal) and deletes the rows that
 * turn out to be pure boilerplate — scraped cookie banners and anti-spam
 * footers that were never vacancies.
 *
 * Telegram rows keep their raw post as the body; they are re-checked against
 * the current post gate (`rejectReason`) instead, which drops ads and
 * chatter ingested before the gate learned to spot them. The dry run lists
 * the Telegram titles it would drop, to review the gate on real posts.
 *
 * Idempotent, and conservative: a row the user already saved (an application
 * or a generated outreach draft) is never deleted.
 *
 * Run with: pnpm --filter @jobradar/api cleanup:junk (DATABASE_URL from the
 * environment / repo-root .env). Pass --prod to run against DATABASE_URL_PROD
 * (the "DB (prod)" workflow), --dry-run to only report.
 */
import { config } from 'dotenv';
import { eq, inArray } from 'drizzle-orm';

import { cleanDescription, MIN_DESCRIPTION_LENGTH } from '../src/ingestion/description';
import { promoMatch, rejectReason } from '../src/ingestion/telegram/telegram-normalize';
import { openScriptDb } from '../src/db/prod-db';
import { applications, outreachEmails, sources, vacancies } from '../src/db/schema';

config({ path: '../../.env' });

async function main(): Promise<void> {
  const prod = process.argv.includes('--prod');
  const dryRun = process.argv.includes('--dry-run');
  const { db, close } = openScriptDb(prod);

  const [telegram] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.slug, 'telegram'));

  const rows = await db
    .select({
      id: vacancies.id,
      sourceId: vacancies.sourceId,
      title: vacancies.title,
      url: vacancies.url,
      description: vacancies.description,
    })
    .from(vacancies);

  const protectedIds = new Set<string>([
    ...(await db.select({ id: applications.vacancyId }).from(applications)).map((r) => r.id),
    ...(await db.select({ id: outreachEmails.vacancyId }).from(outreachEmails)).map((r) => r.id),
  ]);

  const junkIds: string[] = [];
  const rewrites: Array<{ id: string; description: string }> = [];
  const telegramJunk: Array<{ title: string; url: string; reason: string }> = [];
  let telegramScanned = 0;

  for (const row of rows) {
    if (telegram && row.sourceId === telegram.id) {
      telegramScanned += 1;
      const reason = rejectReason(row.description);
      if (reason && !protectedIds.has(row.id)) {
        junkIds.push(row.id);
        const detail = reason === 'promo' ? `promo ${JSON.stringify(promoMatch(row.description))}` : reason;
        telegramJunk.push({ title: row.title, url: row.url, reason: detail });
      }
      continue;
    }
    const cleaned = cleanDescription(row.description);
    if (cleaned.length < MIN_DESCRIPTION_LENGTH) {
      if (!protectedIds.has(row.id)) junkIds.push(row.id);
      continue;
    }
    if (cleaned !== row.description) rewrites.push({ id: row.id, description: cleaned });
  }

  console.log(
    `Scanned ${rows.length - telegramScanned} board vacancies and ${telegramScanned} Telegram posts: ` +
      `${junkIds.length} junk (${telegramJunk.length} Telegram), ` +
      `${rewrites.length} to re-clean${dryRun ? ' (dry run, nothing written)' : ''}.`,
  );
  for (const { title, url, reason } of telegramJunk) {
    console.log(`  telegram junk [${reason}]: ${title.slice(0, 100).replace(/\s+/g, ' ')} — ${url}`);
  }
  if (dryRun) {
    await close();
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
  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
