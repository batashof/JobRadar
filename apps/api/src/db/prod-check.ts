/**
 * Read-only check of the production database connection (ADR-019).
 *
 * Connects exactly like the API does — `DATABASE_URL_PROD` over TLS verified
 * against `DATABASE_CA_CERT_PROD` — and prints what it finds, writing nothing.
 * Proves the secrets before `copy-from-neon`, and shows afterwards whether
 * the Data API roles still hold grants. Runs from the "DB (prod)" workflow.
 *
 * Usage: pnpm --filter @jobradar/api db:check:prod
 */
import { config } from 'dotenv';
import { sql, type SQL } from 'drizzle-orm';

import { DATA_API_ROLES } from './data-api-grants';
import { openScriptDb } from './prod-db';

config({ path: '../../.env' });

interface Executor {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Summarises the connected database in a few printable lines. */
export async function describeDatabase(db: Executor): Promise<string[]> {
  const { rows: info } = await db.execute(
    sql`select current_setting('server_version') as version, current_user as role,
          current_database() as database,
          (select count(*) from information_schema.tables
             where table_schema = 'public' and table_type = 'BASE TABLE')::int as tables`,
  );
  const { rows: exposed } = await db.execute(
    sql`select r.rolname as role, count(c.oid)::int as tables
          from pg_roles r
          left join pg_class c on c.relkind = 'r'
            and c.relnamespace = 'public'::regnamespace
            and has_table_privilege(r.oid, c.oid, 'select, insert, update, delete')
          where r.rolname in (${sql.join(
            DATA_API_ROLES.map((role) => sql`${role}`),
            sql`, `,
          )})
          group by r.rolname order by r.rolname`,
  );

  const { version, database, role, tables } = info[0] ?? {};
  const lines = [
    `Connected: PostgreSQL ${String(version)}, database ${String(database)}, role ${String(role)}.`,
    `Tables in public: ${String(tables)}.`,
  ];
  if (exposed.length === 0) {
    lines.push('No Data API roles on this server (not Supabase).');
  } else {
    for (const row of exposed) {
      lines.push(
        `Data API role ${String(row.role)} can read/write ${String(row.tables)} public table(s).`,
      );
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const { db, close } = openScriptDb(true);
  try {
    for (const line of await describeDatabase(db)) console.log(line);
  } finally {
    await close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
