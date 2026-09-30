import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { createPool } from './pool-config';
import * as schema from './schema';

export interface ScriptDb {
  db: NodePgDatabase<typeof schema>;
  close: () => Promise<void>;
}

/**
 * Opens the database a maintenance script works on (ADR-019).
 *
 * `--prod` targets `DATABASE_URL_PROD` (+ `DATABASE_CA_CERT_PROD`), anything
 * else the local `DATABASE_URL`. Plain node-postgres over TCP in both cases —
 * the Neon HTTP driver is gone with Neon. Prod scripts are meant to run from
 * the "DB (prod)" GitHub Actions workflow, where outbound 5432 is open.
 */
export function openScriptDb(prod: boolean): ScriptDb {
  const url = prod ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
  if (prod && !url) throw new Error('DATABASE_URL_PROD is not set');
  const ca = prod ? process.env.DATABASE_CA_CERT_PROD : process.env.DATABASE_CA_CERT;

  const pool = createPool(url, ca, (error) =>
    console.warn(`idle connection dropped: ${error.message}`),
  );
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
