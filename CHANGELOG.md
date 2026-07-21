# Changelog

All notable changes to JobRadar are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

- Phase 4 remainder: Telegram digest bot, browser extension, more sources, funnel stats, calendar sync.

### Fixed

- Default Gemini model is now the evergreen `gemini-flash-latest` alias (pinned `gemini-2.0-flash` has no free-tier quota anymore and `gemini-2.5-flash` is closed to new users). Live E2E 2026-07-21: brief + cover letter + resume scoring verified end-to-end on `gemini-3.1-flash-lite` (Groq geo-blocks this network with 403 — the gateway failover handled it as designed; Groq still works from Render).

## [1.1.0] — 2026-07-21

**Phase 4: the apply assistant (ADR-011) — from a matched vacancy to a sent application without leaving the app.**

### Added

- **LLM gateway** (`llm/`, ADR-005): Groq → OpenRouter → Gemini free tiers via their OpenAI-compatible endpoints, failover on any error, friendly 503 when no key is set; `llmProviders` in `/health`.
- **Resumes**: PDF upload (5 MB cap, magic-byte check), server-side text extraction (pdf-parse v2), single active resume, download, delete (409 if referenced by sent applications); `/app/resume` page + Resume nav item.
- **Vacancy detail page** (`/app/vacancies/[id]`): full stored description in-app; card titles link internally, "Open original ↗" preserved.
- **Apply-contact extraction** at the upsert choke point (email → Telegram handle on contact-ish lines / t.me link → apply URL) + idempotent `backfill:contacts` script (`--prod` runs over Neon HTTPS); contact rendered as mailto/t.me on the detail page. Backfilled: 67/275 locally, 68/276 in prod.
- **On-demand Russian brief**: `POST /vacancies/:id/brief`, cached in `summary_ru` (`?force=true` regenerates); fit section uses the active resume.
- **On-demand cover letter**: `POST /vacancies/:id/cover-letter` — vacancy's language, English capped at the level evident in the resume, 120–180 words, real experience over volume; editable textarea.
- **Email apply via Gmail**: OAuth connect (HMAC-signed state, AES-256-GCM-encrypted refresh token), LLM-drafted subject+body around the edited cover letter, recipient pre-filled from the extracted contact, resume PDF attached, **explicit confirmation before every send**; sends recorded in `outreach_emails` and reflected on the kanban (saved → applied).
- **LLM resume ↔ vacancy matching**: budget-capped (10/run) scoring of rules-matched vacancies, permanent `resume_matches` cache, piggybacks on the ingestion match job + `POST /matches/resume-score`; "CV NN%" badge and Russian fit explanation on Matches.

### Notes

- DB migration `0002` (resumes, resume_matches, outreach_emails, vacancy/user columns) applied locally and to prod Neon.
- Developer TODO to activate the LLM/Gmail paths in prod: set `GROQ_API_KEY` (or OpenRouter/Gemini) and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT` on Render. Everything degrades gracefully until then.
- Tests: 203 api + 55 web.

## [1.0.0] — 2026-07-20

**v1.0 release: the aggregator + application CRM scoped in PRODUCT.md, live and in daily use.**

### Added

- Root README rewritten for the release: real stack table, shipped-scope summary, and screenshots (feed, matches, board, dashboard) in `docs/screenshots/`.

### Notes

- Scope shipped across 0.1.x–0.3.x: auth + sessions, search profiles, three sources (Telegram MTProto primary, RemoteOK, WeWorkRemotely) on a 4-hour cron, heuristic dedup, FTS feed with filters, rules-based matching + Matches page, kanban board with notes and follow-up reminders, Sentry on both apps.
- The daily email digest (Resend) is deferred until after v1.0 by developer decision — matches and reminders are delivered in-app.
- Domain: the free `job-radar-web-phi.vercel.app` subdomain is the v1.0 domain (zero-budget, ADR-001); a custom domain remains optional.
- Sentry DSNs still need to be set in the Render/Vercel dashboards (developer TODO) — monitoring is a no-op until then.

## [0.3.4] — 2026-07-20

**v1.0 release prep: error monitoring on both apps (ADR-010).**

### Added

- **Sentry on `apps/api`** (`@sentry/nestjs`): `instrument.ts` initializes before any other import, `SentryModule.forRoot()` + a global `SentryGlobalFilter` capture HTTP errors, and the ingestion processor reports source-run failures via `Sentry.captureException` (queue jobs run outside the request lifecycle, so the global filter can't see them).
- **Sentry on `apps/web`** (`@sentry/nextjs`): `instrumentation.ts` (Node + Edge), `instrumentation-client.ts` (browser), and `withSentryConfig` in `next.config.ts` (tunnel route, source-map upload when build-time credentials are present).
- `sentryConfigured` presence flag in `GET /health` checks, mirroring `telegramConfigured`.

Everything is DSN-gated: with `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` unset the SDKs are a no-op, so local dev, CI and tests never touch Sentry and the $0 budget holds (ADR-001). Tracing and source-map upload are opt-in.

## [0.3.3] — 2026-07-20

**Phase 3: in-app follow-up reminders ("no answer for N days").**

### Added

- Shared reminder logic (`REMINDER_DEFAULT_DAYS = 7`, waiting stages applied/screening/tech_interview, `isReminderDue`/`daysSinceActivity` helpers) used by both apps.
- `GET /applications/reminders`: applications in a waiting stage with no activity past `remind_after_days` (per-application override) or the default, oldest first.
- Dashboard **"Follow-ups due"** list (real content on `/app` at last) and red **follow-up hints on board cards**; per-card "Remind after N days" input in the notes panel (PATCH on blur).

### Fixed

- Kanban board hydration warning: `DndContext` now uses a stable id instead of dnd-kit's render-order counter, which differed between server and client.

## [0.3.2] — 2026-07-20

**Phase 3: rules-based vacancy ↔ profile matching, materialized and browsable.**

### Added

- **Matching engine** (`apps/api/src/matching`): rules-based scorer — hard filters (work format, employment type, salary minimum within one currency) reject; keyword hits (Unicode word boundaries, RU+EN, title > description) and stack hits produce the score. Unknown vacancy attributes never reject.
- Matches materialized in `profile_matches` via a diff (insert/update score/delete), preserving `matched_at`/`digested_at` on rescore. Recomputed by a `match` queue job after every ingestion + dedup cycle, and inline on profile create/update (inactive profiles hold no matches).
- `GET /matches` (score-ordered, paginated, optional `profileId` filter with ownership check) and `GET /matches/profiles` (per-profile match counts); shared `matchQuerySchema`/`MatchFeed` contracts.
- Web **Matches page** (`/app/matches`): SSR first page, profile filter buttons with counts, score badges, save-to-board, pagination; `VacancyCard` extracted from the feed for reuse.

Also rolls up the post-0.3.1 Telegram go-live work:

- Default Telegram channel list in the source seed (`job_react`, `geekjobs`, `remote_it_jobs` — frontend/fullstack focus, verified live): first real MTProto ingestion run brought 136 vacancies (115 canonical after dedup) into the local feed.
- `telegramConfigured` flag in `GET /health` checks (presence-only, mirrors `ingestionTokenConfigured`) — used to diagnose missing Render secrets during the Telegram prod rollout.
- **Telegram source live in production** (2026-07-20): secrets on Render, channels in prod Neon, 136 vacancies ingested (115 canonical), verified end-to-end through the prod web proxy.

## [0.3.1] — 2026-07-20

**ADR-009 implementation: Telegram ingestion worker + feed source filter.**

### Added

- **Telegram ingestion worker** (primary source, ADR-009): GramJS/MTProto reads public channels from `sources.config.channels`, regex-first parsing (title, company, salary with currency, work format, employment type, location), `external_id = <channel>:<msgId>`, `t.me` deep link as the vacancy URL. Skips politely (no alert) until `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_SESSION` and the channel list are configured; respects FLOOD_WAIT.
- Interactive `pnpm --filter @jobradar/api telegram:session` helper that logs in over MTProto and prints the session string to store as a secret.
- Feed **platform filter**: `sources` query filter on `GET /vacancies`, new `GET /vacancies/sources` endpoint (per-source canonical counts), source checkboxes with counts and labeled source badges in the web feed.

### Fixed

- Feed hydration mismatch: vacancy dates now format with a fixed locale, so SSR and client output match.

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
