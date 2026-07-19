# ADR-008: ORM — Drizzle

- Status: Accepted
- Date: 2026-07-19

## Context

Phase 1 requires the final ORM choice (Prisma vs Drizzle, deferred from ARCHITECTURE.md). Requirements from the data model and constraints:

- Postgres FTS: a **generated `tsvector` column** with a GIN index on `vacancies` (DATA_MODEL.md).
- Postgres-specific shapes: enum arrays (`work_format[]`), `text[]`, `jsonb`, composite PK (`profile_matches`).
- First-class migrations (a stated learning goal).
- Fast cold starts: the API sleeps on Render's free tier (ADR-007), so runtime weight matters.

## Decision

Use **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`, `pg` driver).

- Generated columns, enum arrays, composite PKs and custom types (`tsvector`) are expressible directly in the schema; Prisma models `tsvector` only as `Unsupported()` with hand-written migration SQL.
- Pure-TS runtime, no query engine — smaller images and faster cold starts.
- SQL-first API doubles as SQL practice, matching the project's learning goal.
- Migrations: `drizzle-kit generate` (SQL files under version control) + `drizzle-kit migrate`.

## Consequences

- Less magic than Prisma: relations/joins are more explicit; generated migration SQL should be reviewed before committing.
- Schema lives in `apps/api/src/db/schema.ts`; migrations in `apps/api/drizzle/`. DATA_MODEL.md must stay in sync with the schema file.
- If Drizzle becomes a bottleneck, Prisma remains viable — the DB itself stays plain Postgres, so switching is a code-level migration (new ADR).
