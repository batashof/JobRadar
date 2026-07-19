# Worklog

> Chronological log of work done. Newest entries on top. Every session that changes the repo must add an entry (see CLAUDE.md).

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
