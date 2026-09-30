# ADR-019: Production Postgres moves from Neon to Supabase

- Status: Accepted
- Date: 2026-09-30
- Narrows the database line of ADR-001 ("Neon/Supabase") to Supabase

## Context

Production Postgres has lived on Neon's free plan since 2026-07-19. Its limits are **100 CU-hours of compute per month** and 0.5 GB of storage per project. The compute is billed while it is awake, and it only sleeps (scale-to-zero) after **5 minutes without a query**. When the monthly hours run out, the compute is **suspended until the next month**.

That model assumes a database that is idle most of the day. JobRadar's API is the opposite by design (ADR-015 §7):

- the planner tick queries Postgres **every minute**, the digest runner every five;
- the keep-alive workflow (ADR-006) keeps the Render process, and therefore both timers, running around the clock.

So Neon never gets its 5 idle minutes. At the smallest size (0.25 CU) that is ~0.25 × 730 h ≈ **180 CU-hours a month against a budget of 100**. The symptom matches what the developer sees: towards the end of every month the database is suspended and **digests stop arriving**. Relaxing the timers would only move the date: ingestion, the keep-alive and real use still wake it.

## Decision

Host production Postgres on **Supabase's free plan**, which is a regular always-on Postgres instance with **no compute-hour quota**. Supabase was already named in ADR-001 and ARCHITECTURE.md, so no new kind of dependency is introduced.

1. **Connection: the session pooler.** Supabase's direct host is IPv6-only, and neither Render nor GitHub-hosted runners reach it. The Supavisor **session pooler** (`…pooler.supabase.com:5432`, IPv4) behaves like a direct connection for node-postgres, so `DATABASE_URL` on Render points there.
2. **TLS stays verified.** Supabase signs its certificates with its own root CA. node-postgres treats `sslmode=require` as `verify-full`, so a plain Supabase URL fails with "self-signed certificate in certificate chain". The fix is not to turn verification off: `DATABASE_CA_CERT` carries the CA (PEM), and `buildPoolConfig` passes it to `pg` and strips every TLS parameter from the URL (`ssl`, `sslmode`, `sslnegotiation`, `sslrootcert`, …). The URL would otherwise override the `ssl` object, since pg merges the parsed URL last; `ssl=true` or `sslnegotiation=direct` would replace the CA with Node's default trust store. Without the variable the URL is used as is, so local Docker Postgres is unaffected. `GET /health` reports `dbHost`, `dbCaConfigured` and the driver's `dbError`, so the switch can be checked from outside.
3. **Prod maintenance runs in GitHub Actions.** The developer's network blocks outbound TCP 5432, which is why `neon-apply.ts` spoke Neon's HTTP driver. Supabase has no such driver. The `DB (prod)` workflow (manual dispatch) runs migrations, the backfills and `cleanup:junk` from a runner where 5432 is open. The scripts share `openScriptDb(prod)` over plain `pg`, and `@neondatabase/serverless` is removed.
4. **One-off data move: data only.** The target schema is created by our own Drizzle migrations (`db:migrate:prod --no-seed`), then `pg_dump --data-only --schema=public` from Neon (its direct host; the `-pooler` host is PgBouncer in transaction mode) is restored in a single transaction. This means nothing Neon-specific can travel across, a failed restore leaves the target empty, and the script refuses to run against a target that already has rows. Afterwards the target's per-table row counts must equal the **dump's**: the dump is one snapshot, while Neon may still be taking writes from the live API, so a difference against live Neon is reported as a warning (those rows did not travel) rather than failing a copy that is correct. Generated columns (`search_vector`) are recomputed on insert, not copied. The self-referencing foreign keys (`canonical_vacancy_id`, `carried_from_block_id`) need no `--disable-triggers`: they are checked at the end of each `COPY`. The script also prints the source size against the 500 MB limit and drops pg_dump 17+'s `SET transaction_timeout` for targets older than 17.
5. **Supabase's Data API is switched off, and its roles hold no grants.** Supabase exposes the `public` schema over PostgREST and grants `anon`, `authenticated` and `service_role` full DML on every new table in it. JobRadar's tables have no row-level security because only the API connects. Nothing uses the Data API, so it is disabled in the project settings instead of adding RLS policies nobody needs. As a second layer, `db:migrate:prod` revokes those roles' privileges on all tables and sequences in `public`, and in the migrating role's default privileges, so a Data API switched back on still exposes nothing. On plain Postgres the roles do not exist and the step is a no-op.
6. **A dropped idle connection is logged, not fatal.** With a pooler in between, idle connections do get closed (Supavisor restarts, platform maintenance). pg reports that as an `error` event on the pool, and without a listener Node treats it as an uncaught exception and kills the process, taking the planner tick and the digest runner with it. `createPool` attaches the listener; the pool has already discarded the broken client, and the next query reconnects.

## Consequences

- The end-of-month outage goes away: there is no compute budget to exhaust, and the per-minute tick costs nothing.
- **Storage stays tight: 500 MB, the same order as Neon's 0.5 GB.** Descriptions (~4.5k chars, ~300 postings a day), the FTS index and PDFs in `bytea` (ADR-011) keep growing. This ADR does not address that. Retention of old non-canonical vacancies is the next lever, when the size calls for it.
- A Supabase free project pauses after 7 days with no activity. JobRadar queries it every minute, so this cannot trigger while the API is up.
- Prod scripts can no longer be run from the developer's machine. The workflow is the only path, which also means every run against prod leaves a log.
- Neon's database is kept (not deleted) until a few digests have gone out from Supabase, as a fallback.
- The cutover steps (Supabase project, secrets, copy, Render switch, verification, rollback) are in [runbooks/supabase-cutover.md](../runbooks/supabase-cutover.md).
