import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { DATA_API_ROLES, revokeDataApiGrants } from './data-api-grants';

const dialect = new PgDialect();

function fakeDb(existingRoles: string[]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = jest.fn(async (query: SQL) => {
    queries.push(dialect.sqlToQuery(query));
    const isRoleLookup = queries.length === 1;
    return { rows: isRoleLookup ? existingRoles.map((rolname) => ({ rolname })) : [] };
  });
  return { db: { execute }, queries };
}

describe('revokeDataApiGrants', () => {
  it('looks up only the Data API roles', async () => {
    const { db, queries } = fakeDb([]);
    await revokeDataApiGrants(db);
    expect(queries[0]?.sql).toContain('from pg_roles');
    expect(queries[0]?.params).toEqual([...DATA_API_ROLES]);
  });

  it('does nothing on plain Postgres, where the roles do not exist', async () => {
    const { db, queries } = fakeDb([]);
    await expect(revokeDataApiGrants(db)).resolves.toEqual([]);
    expect(queries).toHaveLength(1);
  });

  it('revokes table and sequence grants, now and by default, from each role', async () => {
    const { db, queries } = fakeDb(['anon', 'authenticated']);
    await expect(revokeDataApiGrants(db)).resolves.toEqual(['anon', 'authenticated']);

    expect(queries.slice(1).map((q) => q.sql)).toEqual([
      'revoke all on all tables in schema public from "anon"',
      'revoke all on all sequences in schema public from "anon"',
      'alter default privileges in schema public revoke all on tables from "anon"',
      'alter default privileges in schema public revoke all on sequences from "anon"',
      'revoke all on all tables in schema public from "authenticated"',
      'revoke all on all sequences in schema public from "authenticated"',
      'alter default privileges in schema public revoke all on tables from "authenticated"',
      'alter default privileges in schema public revoke all on sequences from "authenticated"',
    ]);
  });
});
