# Changelog

All notable changes to JobRadar are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

- Phase 1 — Data core: ORM choice (ADR-008), schema + migrations, ingestion workers, dedup, cron.

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
