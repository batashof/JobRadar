# Changelog

All notable changes to JobRadar are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

- Phase 1 (remaining): deploy verification (Render env vars, hh from prod IPs), then phase exit.

## [0.1.5] — 2026-07-20

### Added

- `/health` component diagnostics (`checks`): DB and Redis reachability with timeouts, configured Redis host (no credentials), whether `INGESTION_TOKEN` is set.

### Fixed

- Malformed `REDIS_URL` (stray quotes/whitespace, wrong scheme) no longer crashes bootstrap — it is sanitized, validated, and logged; the app boots with the queue disabled instead. Fixes the failed Render deploy after env vars were added.

## [0.1.4] — 2026-07-19

### Added

- Dedup v1 (ADR-004): pure-TS trigram (Dice) title similarity + same normalized company + 14-day published window; earliest-ingested vacancy stays canonical, chains compressed; runs as a queue job after every ingestion round; thresholds configurable via `DEDUP_SIMILARITY_THRESHOLD` / `DEDUP_WINDOW_DAYS`.
- Ingestion cron (ADR-006): GitHub Actions workflow every 4 hours (+ manual dispatch with `force`), Render cold-start tolerant, no-op with a warning while the host lacks `INGESTION_TOKEN`.
- 11 dedup unit tests.

### Fixed

- `.env` resolution no longer depends on the process working directory.

## [0.1.3] — 2026-07-19

### Added

- BullMQ wiring (`@nestjs/bullmq`, Redis via `REDIS_URL`) with an `ingestion` queue.
- `POST /ingestion/run` hook: bearer-token guard (`INGESTION_TOKEN`, timing-safe compare), enqueues one job per active source; 3 attempts with exponential backoff.
- hh.ru worker: per-profile queries (`keywords OR`-joined, `schedule=remote` for remote-only profiles), pagination with delays, honest User-Agent, 429/Retry-After handling, snippet tag stripping, salary/employment/schedule mapping (RUR→RUB).
- RemoteOK worker: JSON feed, legal-notice filtering, HTML stripping, link-back URLs per their API terms.
- Shared chunked vacancy upsert keyed on `(source_id, external_id)`; company-name normalizer (RU/EN legal suffixes) for the dedup key.
- Politeness: 4-hour minimum interval per source (skip unless `force`), `last_run_status` bookkeeping (`ok`/`empty`/`error`).
- 15 new unit tests (normalizers, company names, token guard).

## [0.1.2] — 2026-07-19

### Added

- Idempotent seed (`pnpm --filter @jobradar/api db:seed`): source registry (`hh`, `remoteok` active; `weworkremotely` registered but inactive) and, outside production, a dev user with a default remote-React search profile.
- Seed data unit tests.

## [0.1.1] — 2026-07-19

### Added

- ADR-008: Drizzle as the ORM (`drizzle-orm` + `drizzle-kit`, `pg` driver).
- Full DB schema in `apps/api/src/db/schema.ts` per DATA_MODEL.md: 5 enums, 6 tables, generated `tsvector` column with GIN index, composite PK on `profile_matches`, unique `(source_id, external_id)` and `(user_id, vacancy_id)`.
- Initial migration `apps/api/drizzle/0000_init-schema.sql`; `db:generate` / `db:migrate` scripts.
- Nest `DbModule` (global, lazy `pg` Pool via `ConfigService`) and `ConfigModule` wired into the app.
- Schema unit tests (tables, unique indexes, GIN/generated column, composite PK, enum values).

## [0.1.0] — 2026-07-19

**Phase 0 (Foundation) complete**: both apps deployed over HTTPS, CI green.

### Added

- Production hello-world deployments: web on Vercel (<https://job-radar-web-phi.vercel.app>), api on Render (<https://jobradar-api-ptvp.onrender.com/health>).
- `apps/web/vercel.json`: build `packages/shared` before `next build` (fixes Vercel monorepo build).

## [0.0.5] — 2026-07-19

### Added

- `apps/api/Dockerfile` (multi-stage pnpm monorepo build, production-only bundle via `pnpm deploy`) and root `.dockerignore`; image built and smoke-tested locally.
- `render.yaml` blueprint: API as a free-tier Docker web service on Render with `/health` health check.
- ADR-007: API hosting on Render free tier (Railway and Fly.io no longer offer free tiers).

### Changed

- ARCHITECTURE, README, ROADMAP updated: API host is Render; ORM decision renumbered to ADR-008.

## [0.0.4] — 2026-07-19

### Added

- GitHub Actions CI (`.github/workflows/ci.yml`): build, lint, typecheck and tests on every PR and on pushes to `main`; pnpm cache, frozen lockfile, per-ref concurrency cancellation.

## [0.0.3] — 2026-07-19

### Added

- `docker-compose.yml` for local dev: Postgres 17 (alpine) + Redis 8 (alpine) with healthchecks and persistent volumes.
- `.env.example` documenting `DATABASE_URL`, `REDIS_URL`, API port/CORS origin and `NEXT_PUBLIC_API_URL` (values match compose defaults).
- README: infrastructure quick-start (docker compose up/down) in the Development section.

## [0.0.2] — 2026-07-19

### Added

- Monorepo scaffold on pnpm workspaces: `apps/web`, `apps/api`, `packages/shared`.
- `apps/web`: Next.js 16 (App Router, TypeScript) hello-world page.
- `apps/api`: NestJS 11 hello-world with `GET /health` endpoint (returns service name, version, timestamp) and a Jest unit test.
- `packages/shared`: shared TypeScript package (`APP_NAME` constant, `HealthResponse` type), consumed by both apps.
- Shared strict `tsconfig.base.json`; per-package `build` / `dev` / `lint` / `typecheck` / `test` scripts wired to root scripts.
- ESLint 9 flat configs: `eslint-config-next` (web), `typescript-eslint` (api).
- `apps/web`: Vitest + React Testing Library setup with home-page tests.
- CLAUDE.md conventions: commit & push after every coherent chunk of work; tests are mandatory for both apps.

## [0.0.1] — 2026-07-19

### Added

- Project documentation set: README, PRODUCT, ARCHITECTURE, DATA_MODEL (draft), DATA_SOURCES, ROADMAP, RISKS.
- ADRs 001–006 (zero budget, separate backend, no LinkedIn scraping, heuristic dedup, LLM free-tier failover, GitHub Actions cron).
- CLAUDE.md — AI-assistant context entry point with worklog and versioning conventions.
- docs/WORKLOG.md — chronological work log.
- Original planning document preserved as docs/original-plan.ru.md.
