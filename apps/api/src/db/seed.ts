import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';
import { DEV_PROFILE, DEV_USER, SEED_SOURCES } from './seed-data';

config({ path: '../../.env' });

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  for (const source of SEED_SOURCES) {
    await db
      .insert(schema.sources)
      .values(source)
      .onConflictDoUpdate({
        target: schema.sources.slug,
        set: { kind: source.kind, config: source.config, isActive: source.isActive },
      });
  }
  console.log(`Seeded ${SEED_SOURCES.length} sources.`);

  if (process.env.NODE_ENV !== 'production') {
    const [user] = await db
      .insert(schema.users)
      .values(DEV_USER)
      .onConflictDoUpdate({ target: schema.users.email, set: { updatedAt: new Date() } })
      .returning();
    if (!user) throw new Error('Dev user upsert returned no row');

    const existingProfile = await db.query.searchProfiles.findFirst({
      where: eq(schema.searchProfiles.userId, user.id),
    });
    if (!existingProfile) {
      await db.insert(schema.searchProfiles).values({ ...DEV_PROFILE, userId: user.id });
    }
    console.log(`Seeded dev user ${user.email} with a default search profile.`);
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
