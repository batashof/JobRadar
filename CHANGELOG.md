# Changelog

All notable changes to JobRadar are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

- Phase 3 — Delivery & notifications (matching, daily digest, reminders).
- Direction change (ADR-009): hh.ru dropped as a source; **Telegram job channels** become the primary v1.0 source (MTProto). Feed to show source per vacancy + a platform filter (checkboxes). Vacancies link out to the original (no in-app apply).

## [0.3.0] — 2026-07-20

**Phase 2 (User & UI) complete and deployed.** The author can sign up, browse and search vacancies, manage search profiles, and track applications on a kanban board — live in production.

### Added

- Production deployment: sessions migration applied to Neon; web (Vercel) proxies `/api` to the API (Render) with a first-party session cookie.

### Fixed

- Vercel `API_ORIGIN` had a stray trailing space that broke the `/api` rewrite (baked at build time); corrected and rebuilt. Correct value: `https://jobradar-api-ptvp.onrender.com`.

## [0.2.5] — 2026-07-20

**Phase 2 — application kanban + notes.** All phase-2 features are now built and verified locally; deployment is the only remaining gate.

### Added

- API `applications` module (guarded, user-scoped): `GET/POST /applications`, `PATCH/DELETE /applications/:id`, and `POST /applications/reorder` (batch stage + order in a transaction). `applied_at` stamped when a card reaches applied-or-later; duplicate vacancy → 409.
- Shared contracts: `applicationCreateSchema`, `applicationUpdateSchema`, `applicationReorderSchema`, `APPLICATION_STAGES`, `ApplicationItem`.
- Web `/app/board`: @dnd-kit kanban with 7 stage columns, cross-column drag-and-drop persisted via the reorder endpoint, per-card notes editor (PATCH on blur) and remove.
- Feed "Save" button adds a vacancy to the board; already-tracked vacancies show "On board ✓".

## [0.2.4] — 2026-07-20

**Phase 2 — vacancy feed.** Full-text search, filtering, and pagination over the aggregated vacancies.

### Added

- API `GET /vacancies` (guarded): Postgres full-text search via `websearch_to_tsquery` + `ts_rank` on the generated `search_vector`, filters for work format / employment type / minimum salary, canonical vacancies only, offset pagination with a total count.
- Shared `vacancyQuerySchema` (coerces query-string values, comma-or-array enum filters, bounded `pageSize`), `VacancyListItem`/`VacancyFeed` types.
- Web `/app/feed`: server-rendered first page + client `FeedBrowser` (search box, format/type checkboxes, min-salary, prev/next pagination) with vacancy cards linking out to the source.
- Non-positive salaries (0/0 from some sources) are shown as "no salary" rather than "0–0".

## [0.2.3] — 2026-07-20

**Phase 2 — search profile CRUD.** Users can create, edit, and delete the search profiles that drive matching and digests.

### Added

- API `profiles` module (guarded by the session `AuthGuard`, every query scoped to the current user): `GET/POST /profiles`, `PATCH/DELETE /profiles/:id`. Cross-user access returns 404.
- Shared zod contracts (`profileCreateSchema` with defaults, truly-partial `profileUpdateSchema`, `SearchProfile` type, `WORK_FORMATS`/`EMPLOYMENT_TYPES`) — currency uppercased, `salaryMin ≤ salaryMax` enforced.
- Web `/app/profiles`: server-rendered list + client create/edit/delete manager, `ProfileForm`, `Badge` component. Header gains Dashboard/Profiles navigation.
- `serverApiGet` helper for cookie-forwarding server-side reads.

## [0.2.2] — 2026-07-20

**Phase 2 — web foundation + auth UI.** The web app gains a real design system and a working sign-up / sign-in / sign-out flow wired to the auth backend.

### Added

- Tailwind CSS v4 + a small shadcn/ui-style component set (Button, Input, Label, Card) with light/dark theme tokens.
- `/login` and `/signup` pages sharing an `AuthForm` (client-side zod validation reusing the shared schemas, API error surfacing).
- Auth-protected `/app` area: a server layout resolves the user from the session cookie (redirects to `/login` if absent/expired); `AuthProvider` + `AppHeader` show the signed-in email and a logout button.
- `middleware.ts` gates `/app` on session-cookie presence (real validation stays server-side, no redirect loops).
- Same-origin `/api` proxy via Next rewrites (keeps the session cookie first-party); typed API client (`apiFetch`, `ApiError`) and `lib/auth` helpers.
- `.claude/launch.json` for the local web dev server.

### Changed

- `SESSION_COOKIE_NAME` moved to `@jobradar/shared` as the single source of truth (api + web).
- Root page redirects to `/app`; the phase-0 hello-world home page is gone.

## [0.2.1] — 2026-07-20

**Phase 2 — auth backend.** Email + password authentication with server-side sessions (self-managed in NestJS; no external auth service, per the zero-budget constraint).

### Added

- `sessions` table (opaque token, per-user, expiring) + migration `0001`.
- Auth module: `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- Passwords hashed with scrypt (Node stdlib, memory-hard — no native dependency).
- Session carried in an httpOnly, `SameSite=Lax` cookie (`secure` in production); `AuthGuard` + `@CurrentUser()` for protecting routes.
- Shared zod contracts (`signupSchema`, `loginSchema`, `AuthUser`, `AuthResponse`) reused by web and validated on the API via a `ZodValidationPipe`.
- CORS now sends credentials (cookies) for the eventual direct cross-origin case; the web app will normally proxy `/api` to keep the cookie first-party.

## [0.2.0] — 2026-07-20

**Phase 1 (Data core) complete**: vacancies from two sources (RemoteOK + WeWorkRemotely) land in the production DB automatically every 4 hours, dedup links duplicates, deployed on Render + Neon + Upstash.

### Added

- WeWorkRemotely RSS worker: feed parsing, `Company: Title` splitting, conditional GET (`If-Modified-Since`, 304-aware politeness).

### Changed

- hh source deactivated pending `HH_API_TOKEN` (geo-403 for non-CIS IPs; dev.hh.ru registration requires a Russian phone number). Worker and token support remain in place.

## [0.1.6] — 2026-07-20

### Added

- `/health` redis diagnostics extended: port, TLS flag, and the underlying connection error (WRONGPASS/ETIMEDOUT/... — captured from the ioredis error event, no secrets).
- Optional `HH_API_TOKEN` (dev.hh.ru application token) sent as Bearer + `HH-User-Agent` header — hh.ru geo-blocks anonymous API calls from non-CIS/datacenter IPs (confirmed from both the dev machine and Render).

### Fixed

- `redis://` URLs pointing at `*.upstash.io` get TLS forced (Upstash only accepts TLS; a pasted non-TLS URL is a common dashboard mistake).

## [0.1.5] — 2026-07-20

### Added

- `/health` component diagnostics (`checks`): DB and Redis reachability with timeouts, configured Redis host (no credentials), TLS flag, whether `INGESTION_TOKEN` is set.

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
