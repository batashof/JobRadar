import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { describeDatabase } from './prod-check';

const dialect = new PgDialect();

function fakeDb(exposed: { role: string; tables: number }[]) {
  const queries: string[] = [];
  const execute = jest.fn(async (query: SQL) => {
    queries.push(dialect.sqlToQuery(query).sql);
    if (queries.length === 1) {
      return {
        rows: [{ version: '17.6', role: 'postgres', database: 'postgres', tables: 25 }],
      };
    }
    return { rows: exposed };
  });
  return { db: { execute }, queries };
}

describe('describeDatabase', () => {
  it('reports the server, the database and its tables', async () => {
    const { db } = fakeDb([]);
    const lines = await describeDatabase(db);

    expect(lines[0]).toBe('Connected: PostgreSQL 17.6, database postgres, role postgres.');
    expect(lines[1]).toBe('Tables in public: 25.');
  });

  it('says so when the Data API roles do not exist', async () => {
    const { db } = fakeDb([]);
    const lines = await describeDatabase(db);
    expect(lines).toContain('No Data API roles on this server (not Supabase).');
  });

  it('counts the public tables each Data API role can reach', async () => {
    const { db } = fakeDb([
      { role: 'anon', tables: 0 },
      { role: 'authenticated', tables: 3 },
    ]);
    const lines = await describeDatabase(db);

    expect(lines).toContain('Data API role anon can read/write 0 public table(s).');
    expect(lines).toContain('Data API role authenticated can read/write 3 public table(s).');
  });

  it('only reads', async () => {
    const { db, queries } = fakeDb([]);
    await describeDatabase(db);

    expect(queries).toHaveLength(2);
    for (const query of queries) expect(query.trim()).toMatch(/^select /);
  });
});
