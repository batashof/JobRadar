/**
 * Applies migrations + source seed to the production database (ADR-019), and
 * takes table access away from Supabase's Data API roles.
 *
 * Runs from the "DB (prod)" GitHub Actions workflow with DATABASE_URL_PROD /
 * DATABASE_CA_CERT_PROD from repo secrets. `--no-seed` skips the source upsert
 * — the Neon copy needs an empty schema to restore rows into.
 *
 * Usage: pnpm --filter @jobradar/api db:migrate:prod [--no-seed]
 */
import { config } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { revokeDataApiGrants } from './data-api-grants';
import { openScriptDb } from './prod-db';
import * as schema from './schema';
import { SEED_SOURCES } from './seed-data';

config({ path: '../../.env' });

async function main(): Promise<void> {
  const { db, close } = openScriptDb(true);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations applied.');

    const revoked = await revokeDataApiGrants(db);
    console.log(
      revoked.length
        ? `Data API roles hold no grants on public tables: ${revoked.join(', ')}.`
        : 'No Data API roles on this server (not Supabase) - nothing to revoke.',
    );

    if (process.argv.includes('--no-seed')) return;
    for (const source of SEED_SOURCES) {
      await db
        .insert(schema.sources)
        .values(source)
        .onConflictDoUpdate({
          target: schema.sources.slug,
          set: { kind: source.kind, config: source.config, isActive: source.isActive },
        });
    }
    const rows = await db.select({ slug: schema.sources.slug }).from(schema.sources);
    console.log(`Sources in prod: ${rows.map((r) => r.slug).join(', ')}`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
