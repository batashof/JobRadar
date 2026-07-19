/**
 * Applies migrations + source seed to the production Neon database over HTTPS.
 *
 * Exists because this dev machine's network blocks outbound TCP 5432, so
 * drizzle-kit migrate / plain pg cannot reach Neon locally. Render (prod)
 * connects over regular TCP and does not need this.
 *
 * Usage: pnpm --filter @jobradar/api db:migrate:prod
 */
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

import * as schema from './schema';
import { SEED_SOURCES } from './seed-data';

config({ path: '../../.env' });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_PROD;
  if (!url) throw new Error('DATABASE_URL_PROD is not set (see .env)');

  const db = drizzle(neon(url), { schema });

  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');

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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
