/**
 * Read-only check of the production database connection (ADR-019).
 *
 * Connects exactly like the API does — `DATABASE_URL_PROD` over TLS verified
 * against `DATABASE_CA_CERT_PROD` — and prints what it finds, writing nothing.
 * Proves the secrets before `copy-from-neon`, and shows afterwards whether
 * the Data API roles still hold grants, and reports how much each source
 * (and each Telegram channel) delivered lately, so a dead feed or channel
 * shows up. Runs from the "DB (prod)" workflow.
 *
 * Usage: pnpm --filter @jobradar/api db:check:prod
 */
import { config } from "dotenv";
import { sql, type SQL } from "drizzle-orm";

import { DATA_API_ROLES } from "./data-api-grants";
import { openScriptDb } from "./prod-db";

config({ path: "../../.env" });

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
    lines.push("No Data API roles on this server (not Supabase).");
  } else {
    for (const row of exposed) {
      lines.push(
        `Data API role ${String(row.role)} can read/write ${String(row.tables)} public table(s).`,
      );
    }
  }
  return lines;
}

/** Window for the per-source yield report, in days. */
export const SOURCE_REPORT_DAYS = 14;

function day(value: unknown): string {
  if (value === null || value === undefined) return "never";
  return new Date(value as string).toISOString().slice(0, 10);
}

/**
 * Per-source yield: vacancies published in the last SOURCE_REPORT_DAYS days
 * and the newest one, then the same per Telegram channel (read from the
 * `t.me/<channel>/<id>` URL), so a channel that went quiet is visible.
 */
export async function describeSources(db: Executor): Promise<string[]> {
  const since = sql`now() - make_interval(days => ${SOURCE_REPORT_DAYS})`;
  const published = sql`coalesce(v.published_at, v.ingested_at)`;
  const { rows: bySource } = await db.execute(
    sql`select s.slug, s.is_active as active, s.last_run_at as "lastRunAt",
          s.last_run_status as "lastRunStatus",
          count(v.id) filter (where ${published} >= ${since})::int as recent,
          max(${published}) as newest
          from sources s
          left join vacancies v on v.source_id = s.id
          group by s.id order by s.slug`,
  );
  const { rows: byChannel } = await db.execute(
    sql`select lower(substring(v.url from 't\.me/([A-Za-z0-9_]+)/')) as channel,
          count(*) filter (where ${published} >= ${since})::int as recent,
          max(${published}) as newest
          from vacancies v
          join sources s on s.id = v.source_id and s.slug = 'telegram'
          group by 1 order by 1`,
  );

  const lines = [`Vacancies per source, last ${SOURCE_REPORT_DAYS} days:`];
  for (const row of bySource) {
    lines.push(
      `  ${String(row.slug)}${row.active ? "" : " (inactive)"}: ${String(row.recent)}, ` +
        `newest ${day(row.newest)}, last run ${day(row.lastRunAt)} ${String(row.lastRunStatus ?? "")}`.trimEnd(),
    );
  }
  if (byChannel.length > 0) {
    lines.push(
      `Telegram vacancies per channel, last ${SOURCE_REPORT_DAYS} days:`,
    );
    for (const row of byChannel) {
      lines.push(
        `  ${String(row.channel)}: ${String(row.recent)}, newest ${day(row.newest)}`,
      );
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const { db, close } = openScriptDb(true);
  try {
    for (const line of await describeDatabase(db)) console.log(line);
    for (const line of await describeSources(db)) console.log(line);
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
