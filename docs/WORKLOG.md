# Worklog

> Chronological log of work done. Newest entries on top. Every session that changes the repo must add an entry (see CLAUDE.md).

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
