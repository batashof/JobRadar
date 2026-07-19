# Worklog

> Chronological log of work done. Newest entries on top. Every session that changes the repo must add an entry (see CLAUDE.md).

## 2026-07-20 — Prod ingestion live (remoteok); hh needs app token

- Remotely debugged the Render env setup purely via `/health` diagnostics (no dashboard access): `REDIS_URL` was pasted as non-TLS with a masked-asterisks password → forced TLS for `*.upstash.io` hosts in code, surfaced the real ioredis error (`WRONGPASS`), developer re-copied the password → `redis: ok`.
- Render's `INGESTION_TOKEN` ended up being the local dev value → synced the GH Actions secret to match (single token now, noted in `.env`).
- **Production E2E: `POST /ingestion/run` → 100 RemoteOK vacancies in Neon, source `ok`, dedup ran (0 false links).** Seeded the author's real user (batashof@gmail.com) + "Senior React remote" profile into prod so hh has a query.
- hh.ru from Render IPs: same geo-403 as from the dev machine → `last_run_status: error`. Added optional `HH_API_TOKEN` support (Bearer + HH-User-Agent). **Developer action:** register an app at dev.hh.ru, put the token into Render env as `HH_API_TOKEN`.
- Version 0.1.6. **Phase 1 exit:** everything deployed and working except live hh data (external policy, pending token) — phase stays open on that single caveat.

## 2026-07-20 — Fix: env-var crash on Render + health diagnostics

- After the developer added env vars, the Render deploy failed in ~24s (no rebuild → bootstrap crash). Only bootstrap-time env parsing we have is `new URL(REDIS_URL)` → hardened: trim + strip pasted quotes, validate scheme, return null and log instead of throwing; app boots with queue idle.
- `/health` now returns `checks` (db/redis reachability with 1.5s timeouts, redis host sans credentials, ingestion-token presence) — prod is self-diagnosing without dashboard log access (Claude-in-Chrome has no access to dashboard.render.com).
- 43 api tests green. Version 0.1.5.

## 2026-07-19 — Phase 1: dedup v1 + ingestion cron

- Dedup v1 per ADR-004 as pure TS (no pg_trgm needed): trigram/Dice title similarity, grouped by `company_normalized` (skipping unknown/empty), ±14-day window on published (fallback ingested), earliest-ingested stays canonical, chains compressed. Runs as a `dedup` queue job enqueued after all source jobs (FIFO, concurrency 1). 11 unit tests.
- E2E verified: synthetic cross-source duplicate got linked (101 candidates, 1 linked, zero false positives on 100 real RemoteOK vacancies).
- GitHub Actions ingestion cron every 4h (`17 */4 * * *`) + manual dispatch with `force`; tolerates Render cold starts (150s timeout, retries); exits as a warning-level no-op while the API lacks `INGESTION_TOKEN` (so scheduled runs aren't red before prod env is configured). Secret `INGESTION_TOKEN` set in the repo; the same value is stored as `INGESTION_TOKEN_PROD` in local `.env` — **developer: copy it to Render env vars**.
- Fixed `.env` resolution to be cwd-independent (resolved from compiled module path).
- Version 0.1.4. **Remaining for phase 1 exit:** Upstash Redis + Render env vars (`DATABASE_URL`, `REDIS_URL`, `INGESTION_TOKEN`), then verify ingestion + hh geo-403 from prod.

## 2026-07-19 — Phase 1: ingestion workers (hh.ru + RemoteOK) over BullMQ

- Wired BullMQ (`@nestjs/bullmq`) with Redis from `REDIS_URL`; `POST /ingestion/run` (bearer `INGESTION_TOKEN`, timing-safe) enqueues a job per active source; processor enforces the 4-hour politeness interval and writes `last_run_at`/`last_run_status`.
- hh.ru worker: queries per active search profile, pagination + page delays, honest UA, 429 handling; full normalizer with tests. **Caveat:** live hh API returns geo-403 from this network (any UA) — worker is unit-tested but not E2E-verified; retry from Render's IPs or register an hh app token (dev.hh.ru). No proxies per politeness rules.
- RemoteOK worker: JSON feed, link-back URLs per their terms, HTML-stripped descriptions. **E2E verified locally: 100 real vacancies ingested, source status `ok`; auth hook rejects requests without token (401).**
- 26 api unit tests green. Version 0.1.3.
- **Next step:** dedup v1 (ADR-004) and GitHub Actions cron (ADR-006); Upstash Redis + Render env vars for prod.

## 2026-07-19 — Phase 1: Neon production DB provisioned

- Developer created the Neon project (twilight-boat-64185932, Frankfurt, Postgres 18); connection string stored in local `.env` as `DATABASE_URL_PROD` (gitignored).
- This network blocks outbound TCP 5432, so `drizzle-kit migrate`/plain `pg` can't reach Neon from here → added `db:migrate:prod` (`neon-apply.ts`) which applies migrations + source seed over HTTPS via `@neondatabase/serverless` (drizzle `neon-http` migrator). Render itself will use plain `pg` over TCP.
- Verified: all tables exist in Neon, sources seeded (`hh`, `remoteok` active).
- Still needed on Render (developer, later): `DATABASE_URL`, `REDIS_URL` (Upstash — account not created yet), `INGESTION_TOKEN` env vars.

## 2026-07-19 — Phase 1: seed data

- Idempotent `db:seed` (tsx): upserts the source registry by slug — `hh` (api) and `remoteok` (api, link-back note per their terms) active, `weworkremotely` (rss) registered but inactive per DATA_SOURCES.md "pick one of #2/#3".
- Dev fixtures (user `dev@jobradar.local` + "Senior React remote" profile) seeded only when `NODE_ENV !== 'production'`.
- Verified against local Postgres: rows present, second run adds nothing. Unit tests for seed data. Version 0.1.2.
- **Next step:** hh.ru ingestion worker (fetch, normalize, upsert) — needs BullMQ + Redis wiring first.

## 2026-07-19 — Phase 1: ADR-008 (Drizzle) + full DB schema & migrations

- **ADR-008**: Drizzle over Prisma — generated `tsvector` + GIN index expressible in schema (Prisma needs `Unsupported()` + hand-written SQL), enum arrays / composite PKs first-class, no query engine (fast cold starts on sleeping Render).
- Implemented the entire DATA_MODEL.md schema in `apps/api/src/db/schema.ts`; generated and applied `0000_init-schema.sql` to local Postgres.
- Verified live: FTS query via `search_vector @@ to_tsquery('simple', 'react & typescript')` finds an inserted vacancy; FK constraints enforce delete order. `search_vector` uses `simple` config (mixed RU/EN sources) — noted in DATA_MODEL.md for future relevance tuning.
- Nest wiring: global `DbModule` (lazy `pg` Pool — app still boots without a DB, keeps hello-world deploy alive) + `ConfigModule` reading repo-root `.env`.
- 6 schema unit tests via `getTableConfig` (no DB needed — CI-safe). Version 0.1.1.
- **Next step:** seed data, then hh.ru ingestion worker. Also: provision Neon Postgres and set `DATABASE_URL` on Render before ingestion goes live.

## 2026-07-19 — Phase 0 complete: both apps deployed 🎉

- Developer created Vercel + Render accounts and connected the repo (Vercel root directory `apps/web`, Render via `render.yaml` blueprint).
- Render deploy succeeded as-is: <https://jobradar-api-ptvp.onrender.com/health> returns the health JSON.
- First Vercel build failed (`Module not found: @jobradar/shared` — shared's `dist/` isn't built by plain `next build`). Fixed with `apps/web/vercel.json` buildCommand that builds `@jobradar/shared` first. Second build green: <https://job-radar-web-phi.vercel.app> (note: `job-radar-web.vercel.app` without suffix belongs to someone else's project).
- Phase 0 exit criterion met (both apps over HTTPS, CI green) → ROADMAP marker moved to **phase 1 — Data core**, version **0.1.0**.
- TODO for phase 2 (auth): set `WEB_ORIGIN` env var on Render to the Vercel URL to tighten CORS; set `NEXT_PUBLIC_API_URL` on Vercel when the web app starts calling the API.
- **Next step:** phase 1 — ORM choice (ADR-008), then schema + migrations.

## 2026-07-19 — Phase 0: deployment prep (ADR-007, Dockerfile, render.yaml)

- Hosting research: Railway (no free tier, $5 trial only) and Fly.io (no free tier, card required) both violate ADR-001 → **ADR-007**: API goes to Render's free Docker tier (sleep-after-15-min is already mitigated by ADR-006 cron wake-up). Koyeb is the recorded fallback.
- Added `apps/api/Dockerfile` (multi-stage: filtered pnpm install → build shared+api → `pnpm deploy --legacy --prod` bundle; runs as `node` user) and `.dockerignore`. Verified: image builds, container serves `/health`.
- Added `render.yaml` blueprint; docs synced (ARCHITECTURE diagram/tables, README stack, ROADMAP; ORM ADR renumbered 007→008).
- Installed Vercel CLI 56 via brew. Version bumped to 0.0.5.
- **Blocked on developer:** `vercel login` + linking the repo to a Vercel project (root directory `apps/web`), and creating/connecting a Render account to apply `render.yaml`. Deploy checkbox stays unticked until both hello worlds are live.

## 2026-07-19 — Phase 0: CI pipeline

- Added GitHub Actions workflow: single `checks` job (build → lint → typecheck → test) on `pull_request` and on pushes to `main`; pnpm version taken from `packageManager`, node_modules cached, `--frozen-lockfile`, concurrent runs on the same ref auto-cancelled.
- Verified by watching the first run on `main` complete green.
- Version bumped to 0.0.4.
- **Next step:** hello-world deployments (Vercel for web, Railway/Fly.io for api) — the last phase 0 item.

## 2026-07-19 — Tooling: Homebrew reinstalled, Docker Compose verified

- Reinstalled Homebrew on the dev machine: the old install (Feb 2025) predated macOS 26 and was broken; replaced with fresh Homebrew 6.0.11 (official tarball into `/opt/homebrew`, no sudo needed). Only loss from the old install: an unused duplicate `node@22` (system Node lives in `/usr/local/bin`).
- Installed colima 0.10 + docker CLI + docker-compose via brew; `colima start --cpu 2 --memory 4` runs the Docker daemon.
- Verified the compose stack for real: `docker compose up -d` → both `postgres` and `redis` report healthy; smoke-tested a psql query (PostgreSQL 17.10) and Redis SET/GET. This closes the caveat from the entry below.
- Containers left running for development.

## 2026-07-19 — Phase 0: Docker Compose for local dev

- Added `docker-compose.yml` (Postgres 17-alpine + Redis 8-alpine, healthchecks, named volumes, AOF persistence for Redis) and `.env.example` with matching connection strings; README Development section updated.
- YAML validated with yaml-lint. **Caveat:** could not run `docker compose up` on this machine — no container runtime installed, and Homebrew is broken (needs `sudo chown -R vladislav /opt/homebrew` + `brew update`; current brew predates macOS 26). Verify compose once Docker/OrbStack/colima is installed.
- Version bumped to 0.0.3.
- **Next step:** CI on PR (lint + typecheck + tests), then hello-world deployments (Vercel + Railway/Fly.io).

## 2026-07-19 — Workflow rules & frontend test setup

- CLAUDE.md: added two mandatory conventions — (1) commit & push after every coherent chunk of work, (2) every web/api change ships with tests (web: Vitest + React Testing Library, api: Jest).
- Added Vitest + React Testing Library to `apps/web` with home-page tests (`vitest.config.mts`, `app/page.test.tsx`); `pnpm test` now runs real tests in both apps.
- Note: Vitest `globals: true` is required so Testing Library auto-cleans the DOM between tests.
- **Next step:** Docker Compose for local dev (Postgres + Redis), then CI.

## 2026-07-19 — Phase 0: monorepo scaffold

- Scaffolded the pnpm-workspaces monorepo: `apps/web` (Next.js 16, App Router), `apps/api` (NestJS 11), `packages/shared` (shared types/constants), per ARCHITECTURE.md.
- API exposes `GET /health` returning `HealthResponse` from `@jobradar/shared`; covered by a Jest unit test. Web hello-world page uses `APP_NAME` from the shared package.
- Tooling: strict `tsconfig.base.json`, ESLint 9 flat configs (eslint-config-next / typescript-eslint), root `build`/`lint`/`typecheck`/`test` scripts.
- Pinned TypeScript 5.9 and ESLint 9 (TS 7 / ESLint 10 are not yet supported by ts-jest, typescript-eslint and Next lint plugins).
- Verified locally: workspace build, typecheck, lint, tests all pass; both apps boot and serve (API `/health`, web homepage).
- Version bumped to 0.0.2 (CHANGELOG updated, root `package.json` version in sync).
- **Next step:** Docker Compose for local dev (Postgres + Redis), then CI (lint + typecheck + tests on PR).

## 2026-07-19 — Project bootstrap: documentation & repository

- Turned the original planning document (docs/original-plan.ru.md) into a full English documentation set: PRODUCT, ARCHITECTURE, DATA_MODEL (draft), DATA_SOURCES, ROADMAP, RISKS.
- Recorded key decisions as ADRs 001–006.
- Created CLAUDE.md with context rules, worklog and versioning conventions.
- Initialized git repository, published to GitHub (batashof/JobRadar).
- Version set to 0.0.1 (documentation only, no code yet).
- **Next step:** Phase 0 — monorepo scaffold (`apps/web`, `apps/api`, `packages/shared`), Docker Compose, CI, hello-world deployments.
