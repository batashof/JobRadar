/**
 * The 10-minute ingestion tick, run by the production database itself (ADR-023).
 *
 * GitHub Actions throttles scheduled workflows on the free tier: the
 * `*\/10` keep-alive actually fired every 4–5 hours (October 2026), so the
 * Render instance slept and the in-process digest tick slept with it. Supabase
 * ships `pg_cron` (a job scheduler inside Postgres) and `pg_net` (async HTTP
 * from SQL) on the free plan, so the database calls `POST /ingestion/run` every
 * 10 minutes instead. The call also keeps the Render instance awake (it sleeps
 * after 15 minutes without inbound requests).
 *
 * The ingestion token lives in Supabase Vault and is read when the job runs,
 * so it never appears in `cron.job`. Idempotent: re-running `enable` replaces
 * the job and the secret.
 *
 * Usage (from the "DB (prod)" workflow):
 *   pnpm --filter @jobradar/api db:schedule:prod enable   # needs INGESTION_TOKEN
 *   pnpm --filter @jobradar/api db:schedule:prod status
 *   pnpm --filter @jobradar/api db:schedule:prod disable
 */
import { config } from 'dotenv';
import { sql, type SQL } from 'drizzle-orm';

import { openScriptDb } from './prod-db';

config({ path: '../../.env' });

export const TICK_JOB = 'jobradar-ingestion-tick';
export const CLEANUP_JOB = 'jobradar-cron-cleanup';
export const TOKEN_SECRET = 'jobradar_ingestion_token';
export const TICK_SCHEDULE = '*/10 * * * *';
export const DEFAULT_API_URL = 'https://jobradar-api-ptvp.onrender.com';

/** A cold Render free instance needs 30–60 s before it answers. */
const HTTP_TIMEOUT_MS = 90_000;

interface Executor {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

/** The SQL the tick runs: a fire-and-forget POST carrying the Vault token. */
export function tickCommand(apiUrl: string): string {
  const url = `${apiUrl.replace(/\/+$/, '')}/ingestion/run`;
  if (!/^https:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(url)) {
    throw new Error(`refusing an unexpected API URL: ${apiUrl}`);
  }
  return `select net.http_post(
  url := '${url}',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret from vault.decrypted_secrets where name = '${TOKEN_SECRET}'
    )
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := ${HTTP_TIMEOUT_MS}
)`;
}

/** `cron.job_run_details` keeps every run forever; a week is plenty. */
export const CLEANUP_COMMAND =
  "delete from cron.job_run_details where end_time < now() - interval '7 days'";

export async function enableSchedule(db: Executor, token: string, apiUrl: string): Promise<void> {
  if (!token) throw new Error('INGESTION_TOKEN is not set');
  const command = tickCommand(apiUrl);

  await db.execute(sql`create extension if not exists pg_cron with schema pg_catalog`);
  await db.execute(sql`create extension if not exists pg_net with schema extensions`);

  const { rows } = await db.execute(sql`select id from vault.secrets where name = ${TOKEN_SECRET}`);
  const existing = rows[0]?.id;
  if (existing) {
    await db.execute(sql`select vault.update_secret(${String(existing)}::uuid, ${token})`);
  } else {
    await db.execute(
      sql`select vault.create_secret(${token}, ${TOKEN_SECRET}, 'JobRadar ingestion hook token (ADR-023)')`,
    );
  }

  // cron.schedule with an existing name replaces that job.
  await db.execute(sql`select cron.schedule(${TICK_JOB}, ${TICK_SCHEDULE}, ${command})`);
  await db.execute(sql`select cron.schedule(${CLEANUP_JOB}, '17 3 * * *', ${CLEANUP_COMMAND})`);
}

export async function disableSchedule(db: Executor): Promise<string[]> {
  const { rows } = await db.execute(
    sql`select jobname from cron.job where jobname in (${TICK_JOB}, ${CLEANUP_JOB})`,
  );
  const names = rows.map((row) => String(row.jobname));
  for (const name of names) await db.execute(sql`select cron.unschedule(${name})`);
  return names;
}

/** Printable state: the jobs, their last runs, and the last HTTP answers. */
export async function describeSchedule(db: Executor): Promise<string[]> {
  const lines: string[] = [];
  const { rows: ext } = await db.execute(
    sql`select extname, extversion from pg_extension where extname in ('pg_cron', 'pg_net') order by extname`,
  );
  lines.push(
    `Extensions: ${ext.map((e) => `${String(e.extname)} ${String(e.extversion)}`).join(', ') || 'none'}.`,
  );
  if (!ext.some((e) => e.extname === 'pg_cron')) return lines;

  const { rows: jobs } = await db.execute(
    sql`select jobid, jobname, schedule, active from cron.job where jobname like 'jobradar-%' order by jobname`,
  );
  if (jobs.length === 0) lines.push('No JobRadar cron jobs.');
  for (const job of jobs) {
    lines.push(
      `Job ${String(job.jobname)}: "${String(job.schedule)}", active ${String(job.active)}.`,
    );
  }

  const { rows: runs } = await db.execute(
    sql`select d.start_time, d.status, d.return_message
          from cron.job_run_details d join cron.job j on j.jobid = d.jobid
          where j.jobname = ${TICK_JOB} order by d.start_time desc limit 6`,
  );
  for (const run of runs) {
    lines.push(
      `  run ${String(run.start_time)}: ${String(run.status)} ${String(run.return_message ?? '')}`.trimEnd(),
    );
  }

  if (ext.some((e) => e.extname === 'pg_net')) {
    const { rows: answers } = await db.execute(
      sql`select created, status_code, timed_out, left(coalesce(error_msg, content, ''), 160) as detail
            from net._http_response order by created desc limit 6`,
    );
    for (const a of answers) {
      lines.push(
        `  http ${String(a.created)}: ${a.timed_out ? 'timed out' : String(a.status_code)} ${String(a.detail)}`.trimEnd(),
      );
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const action = process.argv[2] ?? 'status';
  const { db, close } = openScriptDb(true);
  try {
    if (action === 'enable') {
      await enableSchedule(
        db,
        process.env.INGESTION_TOKEN ?? '',
        process.env.API_URL || DEFAULT_API_URL,
      );
      console.log(`Scheduled ${TICK_JOB} (${TICK_SCHEDULE}) and ${CLEANUP_JOB}.`);
    } else if (action === 'disable') {
      const removed = await disableSchedule(db);
      console.log(
        removed.length ? `Unscheduled: ${removed.join(', ')}.` : 'Nothing to unschedule.',
      );
    } else if (action !== 'status') {
      throw new Error(`unknown action "${action}" (enable | status | disable)`);
    }
    for (const line of await describeSchedule(db)) console.log(line);
  } finally {
    await close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
