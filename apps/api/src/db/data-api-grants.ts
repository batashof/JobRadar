import { sql, type SQL } from 'drizzle-orm';

/** The roles Supabase's Data API (PostgREST) runs requests as (ADR-019). */
export const DATA_API_ROLES = ['anon', 'authenticated', 'service_role'] as const;

interface Executor {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Takes every privilege on our tables away from Supabase's Data API roles.
 *
 * Supabase grants SELECT/INSERT/UPDATE/DELETE on every table created in
 * `public` to `anon`, `authenticated` and `service_role`, so PostgREST can
 * serve them. JobRadar has no row-level security — only the API connects —
 * so with the Data API on, the tables would be one leaked key away from
 * being readable. ADR-019 switches the Data API off; this makes the grants
 * empty as well, so a Data API switched back on still exposes nothing.
 *
 * Covers the existing tables and sequences, and the default privileges of the
 * current role (the one that runs the migrations and owns the tables), so
 * tables from future migrations are not granted either. Idempotent. A role
 * that does not exist is skipped: on plain Postgres (local Docker, CI) this
 * does nothing. Returns the roles it revoked from.
 */
export async function revokeDataApiGrants(db: Executor): Promise<string[]> {
  const { rows } = await db.execute(
    sql`select rolname from pg_roles where rolname in (${sql.join(
      DATA_API_ROLES.map((role) => sql`${role}`),
      sql`, `,
    )}) order by rolname`,
  );
  const roles = rows.map((row) => String(row.rolname));

  for (const role of roles) {
    const name = sql.identifier(role);
    await db.execute(sql`revoke all on all tables in schema public from ${name}`);
    await db.execute(sql`revoke all on all sequences in schema public from ${name}`);
    await db.execute(
      sql`alter default privileges in schema public revoke all on tables from ${name}`,
    );
    await db.execute(
      sql`alter default privileges in schema public revoke all on sequences from ${name}`,
    );
  }
  return roles;
}
