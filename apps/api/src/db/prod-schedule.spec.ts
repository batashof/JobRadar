import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  CLEANUP_JOB,
  TICK_JOB,
  TICK_SCHEDULE,
  TOKEN_SECRET,
  describeSchedule,
  disableSchedule,
  enableSchedule,
  tickCommand,
} from './prod-schedule';

const dialect = new PgDialect();

/** Records each query and answers from `respond` (by SQL text). */
function fakeDb(respond: (sql: string) => Record<string, unknown>[] = () => []) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = jest.fn(async (query: SQL) => {
    const rendered = dialect.sqlToQuery(query);
    queries.push(rendered);
    return { rows: respond(rendered.sql) };
  });
  return { db: { execute }, queries };
}

describe('tickCommand', () => {
  it('posts to the ingestion hook with the token read from Vault at run time', () => {
    const command = tickCommand('https://jobradar-api-ptvp.onrender.com/');

    expect(command).toContain("url := 'https://jobradar-api-ptvp.onrender.com/ingestion/run'");
    expect(command).toContain(`from vault.decrypted_secrets where name = '${TOKEN_SECRET}'`);
    expect(command).toContain('timeout_milliseconds := 90000');
  });

  it('refuses a URL that could break out of the SQL literal', () => {
    expect(() => tickCommand("https://x.dev/'; drop table vacancies; --")).toThrow(
      /unexpected API URL/,
    );
    expect(() => tickCommand('http://insecure.dev')).toThrow(/unexpected API URL/);
  });
});

describe('enableSchedule', () => {
  it('creates the extensions, stores a new token and schedules both jobs every 10 minutes', async () => {
    const { db, queries } = fakeDb();

    await enableSchedule(db, 'secret-token', 'https://api.example.dev');

    const text = queries.map((q) => q.sql);
    expect(text[0]).toContain('create extension if not exists pg_cron');
    expect(text[1]).toContain('create extension if not exists pg_net');
    const create = queries.find((q) => q.sql.includes('vault.create_secret'));
    expect(create?.params).toEqual(['secret-token', TOKEN_SECRET]);
    const tick = queries.find((q) => q.sql.includes('cron.schedule') && q.params[0] === TICK_JOB);
    expect(tick?.params[1]).toBe(TICK_SCHEDULE);
    expect(TICK_SCHEDULE).toBe('*/10 * * * *');
    expect(String(tick?.params[2])).not.toContain('secret-token');
    expect(queries.some((q) => q.params[0] === CLEANUP_JOB)).toBe(true);
  });

  it('updates the token in place when the secret already exists', async () => {
    const { db, queries } = fakeDb((sql) =>
      sql.includes('from vault.secrets') ? [{ id: 'abc' }] : [],
    );

    await enableSchedule(db, 'rotated', 'https://api.example.dev');

    expect(queries.find((q) => q.sql.includes('vault.update_secret'))?.params).toEqual([
      'abc',
      'rotated',
    ]);
    expect(queries.some((q) => q.sql.includes('vault.create_secret'))).toBe(false);
  });

  it('refuses to schedule without a token', async () => {
    const { db } = fakeDb();
    await expect(enableSchedule(db, '', 'https://api.example.dev')).rejects.toThrow(
      /INGESTION_TOKEN/,
    );
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('disableSchedule', () => {
  it('unschedules the JobRadar jobs that exist', async () => {
    const { db, queries } = fakeDb((sql) =>
      sql.includes('from cron.job') ? [{ jobname: TICK_JOB }] : [],
    );

    expect(await disableSchedule(db)).toEqual([TICK_JOB]);
    expect(queries.filter((q) => q.sql.includes('cron.unschedule')).map((q) => q.params)).toEqual([
      [TICK_JOB],
    ]);
  });
});

describe('describeSchedule', () => {
  it('stops at the extension line when pg_cron is missing (plain Postgres)', async () => {
    const { db } = fakeDb();
    expect(await describeSchedule(db)).toEqual(['Extensions: none.']);
  });

  it('lists jobs, recent runs and HTTP answers', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('from pg_extension')) {
        return [
          { extname: 'pg_cron', extversion: '1.6' },
          { extname: 'pg_net', extversion: '0.14' },
        ];
      }
      if (sql.includes('from cron.job where'))
        return [{ jobname: TICK_JOB, schedule: TICK_SCHEDULE, active: true }];
      if (sql.includes('job_run_details'))
        return [{ start_time: 't1', status: 'succeeded', return_message: '1 row' }];
      if (sql.includes('net._http_response'))
        return [
          {
            created: 't1',
            status_code: 202,
            timed_out: false,
            detail: '{"enqueued":[]}',
          },
        ];
      return [];
    });

    expect(await describeSchedule(db)).toEqual([
      'Extensions: pg_cron 1.6, pg_net 0.14.',
      `Job ${TICK_JOB}: "${TICK_SCHEDULE}", active true.`,
      '  run t1: succeeded 1 row',
      '  http t1: 202 {"enqueued":[]}',
    ]);
  });
});
