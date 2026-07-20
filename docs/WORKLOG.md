# Worklog

> Chronological log of work done. Newest entries on top. Every session that changes the repo must add an entry (see CLAUDE.md).

## 2026-07-20 — Telegram source live in production

- Prod Neon updated via `db:migrate:prod` (seed upsert now carries the `telegram` source + channels). Developer set `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_SESSION` on Render — first attempt didn't apply (vars not visible to the service); added a presence-only `telegramConfigured` flag to `GET /health` to make that diagnosable without dashboard access, developer re-saved, flag flipped to `true`.
- Forced prod ingestion run: telegram scanned 150 messages → **136 vacancies upserted, 115 canonical after dedup** (`ok` status). Prod E2E through the Vercel web proxy: signup → `GET /vacancies/sources` returns telegram(115)/remoteok(108)/weworkremotely(25) → `sources=telegram` feed returns 115 with `t.me` deep links.
- GitHub Actions cron (every 4h) now keeps Telegram fresh alongside RemoteOK/WWR — no further action needed.
- **Next step:** phase 3 — vacancy↔profile matching, then the Resend digest.

## 2026-07-20 — Telegram source live locally: channels chosen, first real ingest

- Developer obtained `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` and generated `TELEGRAM_SESSION` via `telegram:session` (all three in local `.env`; **still to be set on Render for prod**).
- **Channel selection** (frontend/fullstack focus): probed candidates via `t.me` previews — `@javascript_jobs` and `@fordev` are chats (groups), not channels; `@job_frontend` is a redirect stub. Picked **`job_react`** (React/JS vacancies, ~15.7k), **`geekjobs`** (IT&Digital), **`remote_it_jobs`** (remote IT). Seeded into `sources.config.channels`.
- **First real MTProto run:** 150 messages scanned → 136 vacancies upserted, 115 canonical after dedup. Companies extracted from labeled lines (СДЭК, Альфа-Банк, OZON, VK…), work format on 91/136; salaries rare (3) — channels seldom post them. Known noise: weekly digest posts (e.g. "Вакансии прошедшей недели") pass the length heuristic — candidate for a digest-post filter later.
- **Browser E2E:** feed shows Telegram badges + `t.me` links; checking the Telegram source checkbox narrows 251 → 115 (Page 1 of 6); `GET /vacancies/sources` returns telegram/remoteok/weworkremotely counts; `sources=telegram,weworkremotely` totals add up.
- **Developer TODO for prod:** set the three `TELEGRAM_*` env vars on Render and update the prod `sources` row (`update sources set config = jsonb_set(config, '{channels}', '["job_react","geekjobs","remote_it_jobs"]') where slug = 'telegram';`) or re-run the seed against prod.
- **Next step:** phase 3 — vacancy↔profile matching, then the Resend digest.

## 2026-07-20 — ADR-009 implemented: Telegram worker + feed source filter (v0.3.1)

- **Feed platform filter (phase-2 leftover):** shared `vacancyQuerySchema` gains a `sources` slug-list filter (shape-validated, not a closed enum — sources are DB-driven); `GET /vacancies` filters via the sources join (count query joins too); new `GET /vacancies/sources` returns per-source canonical-vacancy counts for the checkbox options. Web feed: labeled source badges (`sourceLabel`), source checkboxes with counts. Browser E2E: checking WeWorkRemotely narrowed 129 → 25 vacancies with correct badges/pagination.
- **Telegram ingestion worker (phase-1 leftover, primary source):** GramJS/MTProto client reads `sources.config.channels` (usernames without `@`, 50 messages per channel per run), regex-first normalize — title from first line (markdown/emoji stripped), labeled company/location lines (`Компания:`/`Company:`), salary ranges with mandatory currency marker (`$`/`€`/`₽`/`руб`/`usd`/... , `k`/`к` suffixes; bare number ranges are ignored as dates/ids), work-format and employment-type keyword detection (ru+en). `external_id = <channel>:<msgId>`, `url = t.me/<channel>/<msgId>`, fallback company = `@channel`. Missing secrets or empty channel list → polite skip (warn, `notModified`, no `empty` alert); unauthorized session → error. `floodSleepThreshold: 60` honors FLOOD_WAIT. Seeded `telegram` source (active, empty channel list). Processor/module wired; local pipeline run verified the polite-skip path (`last_run_status='ok'`).
- `pnpm --filter @jobradar/api telegram:session` — interactive helper that logs in and prints the session string; `.env.example` documents `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_SESSION`.
- **Fixed a feed hydration mismatch:** `toLocaleDateString(undefined, …)` produced different date formats on server vs client; pinned the locale.
- pnpm 11 `allowBuilds` placeholders (bufferutil/es5-ext/utf-8-validate from GramJS' `ws`) resolved to `false` — optional native accelerators, not needed.
- 110 api + 24 web tests, lint/typecheck/build clean. Version **0.3.1**.
- **Developer TODO to go live with Telegram:** get api id/hash at my.telegram.org, run `pnpm --filter @jobradar/api telegram:session`, set the three `TELEGRAM_*` env vars on Render, and fill `sources.config.channels` for the `telegram` row in prod (plus re-seed or manual SQL).
- **Next step:** phase 3 — vacancy↔profile matching (rules-based), then the Resend daily digest.

## 2026-07-20 — Source strategy pivot: drop hh.ru, Telegram becomes primary (ADR-009)

- **Decision (ADR-009):** hh.ru is dropped for good — its API geo-403s non-CIS IPs and a dev.hh.ru token needs a Russian phone number (a CIS token/IP is barred by ADR-001). It never went live (inactive since 0.2.0); the worker + `HH_API_TOKEN` plumbing is now inactive legacy code.
- **Telegram job channels promoted from phase 4 to the primary v1.0 source.** Read public channels via MTProto (GramJS): `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` (free, my.telegram.org) + a stored user session string; Bot API can't read arbitrary public channels. Per-channel regex parsing first, LLM later (ADR-005). `external_id = <channel>:<msgId>`, `url = t.me/<channel>/<msgId>`. RemoteOK + WeWorkRemotely stay as secondary sources.
- **Product model confirmed: search + link out, no in-app apply.** The feed will show each vacancy's source and gain a platform filter (checkboxes); the "open vacancy" action is a link to the original (Telegram deep link).
- **Docs updated:** ADR-009 + index, DATA_SOURCES (Telegram = source #1, hh moved to Explicitly excluded), PRODUCT (v1.0 scope 3 & 4, rejected list), ROADMAP (hh struck through, Telegram worker + feed source-filter added as open items), CHANGELOG (Unreleased). No code changes yet.
- **Next step:** implement the Telegram ingestion worker and the feed source badge + platform filter.

## 2026-07-20 — Phase 2 production deploy

- Applied migration `0001` (sessions table) to prod Neon over HTTPS (`db:migrate:prod`); verified the `sessions` columns exist. Developer set `API_ORIGIN` on Vercel and `WEB_ORIGIN`/`NODE_ENV` on Render.
- **Gotcha:** the Vercel `API_ORIGIN` had a stray trailing space, so the Next `/api` rewrite proxied to a malformed URL (`/%20/auth/me` reached the API → 404 on every `/api/*`). Next bakes `rewrites()` destinations at **build time**, so fixing the env var requires a fresh build, not just a redeploy. Re-set `API_ORIGIN` cleanly via CLI; an empty-commit trigger was auto-skipped by Vercel (no file changes), so this real commit forces the rebuild.
- **Correct prod value:** `API_ORIGIN=https://jobradar-api-ptvp.onrender.com` (no trailing slash/space).

## 2026-07-20 — Phase 2: application kanban + notes (all phase-2 features built)

- API `applications` module (guarded, user-scoped): `GET/POST /applications`, `PATCH/DELETE /applications/:id`, `POST /applications/reorder` (batch: each affected column with its cards in order, applied in a transaction; `stage_order` = index). `applied_at` stamped via `coalesce(applied_at, now())` when a card reaches applied/screening/tech_interview/offer; unique `(user, vacancy)` → 409. Route order: `reorder` declared before `:id`.
- Shared: `applicationCreateSchema`/`applicationUpdateSchema`/`applicationReorderSchema` (`z.uuid()`), `APPLICATION_STAGES`, `ApplicationItem` (embeds a vacancy summary).
- Web `/app/board`: **@dnd-kit** kanban (developer chose it) — 7 columns, cross-column drag via `onDragOver` (live move) + `onDragEnd` (finalize + persist affected columns), drag handle so notes/buttons stay interactive, `DragOverlay`. Per-card notes editor (PATCH on blur), remove (optimistic). Feed gains a "Save" button (create application; 409 treated as already-saved) and shows "On board ✓" for tracked vacancies (feed page fetches applications for the tracked set).
- **Curl E2E**: create/409-duplicate/list/reorder (appliedAt set on move to applied, source column reindexed)/notes+stage update/401/delete-204-then-404. **Browser E2E**: saved 2 vacancies from the feed → board shows them in Saved → dragged "Graphic Designer" Saved→Applied → **survived a full reload** (server fetch) → feed shows 2 "On board ✓". 98 api + 23 web tests, lint/typecheck/build clean. Version 0.2.5.
- **Phase 2 status:** every feature built and verified locally. **Exit (deployment) is the only remaining gate** — developer TODO: `pnpm db:migrate:prod` (sessions table on Neon), `API_ORIGIN=https://jobradar-api-ptvp.onrender.com` on Vercel, `WEB_ORIGIN`+`NODE_ENV=production` on Render. Do not start phase 3 until deployed.

## 2026-07-20 — Phase 2: vacancy feed (FTS + filters + pagination)

- API `GET /vacancies` (guarded): Postgres FTS via `websearch_to_tsquery('simple', q)` `@@ search_vector`, ranked by `ts_rank` (falls back to `published_at desc nulls last, ingested_at desc` when no query); filters for work format / employment type (`inArray`) and minimum salary (`salaryMax >= min OR salaryMin >= min`); **canonical only** (`canonical_vacancy_id is null`); offset pagination + `count(*)` total; description truncated to 400 chars in SQL; source slug joined in.
- Shared `vacancyQuerySchema` coerces raw query-string values (numeric strings, comma-joined *or* repeated enum params) with a bounded `pageSize` (≤50); `VacancyListItem`/`VacancyFeed` types.
- Web `/app/feed`: SSR first page (`serverApiGet`) + client `FeedBrowser` (search box, format/type checkboxes, min-salary, prev/next). First fetch skipped via a ref (not state — flipping state re-triggers the effect); cards link out to the source. Non-positive salaries (0/0 from RemoteOK) shown as "no salary".
- **Curl E2E** on 129 real local vacancies: default 129/page-1, `q=react`→10 ranked, multi-word `q=python engineer`→3, `workFormat=remote` filter, `pageSize=5&page=2` pagination, 400 on `pageSize=999`, 401 unauthenticated. **Browser E2E**: SSR feed → search "react" narrows to 10 (Page 1 of 1) → 0/0 salary hidden. 90 api + 17 web tests, lint/typecheck/build clean. Version 0.2.4.
- **Next step:** application kanban + notes (last phase-2 item) — likely needs a drag-and-drop lib choice.

## 2026-07-20 — Phase 2: search profile CRUD

- API `profiles` module: `GET/POST /profiles`, `PATCH/DELETE /profiles/:id`, guarded by the session `AuthGuard`, every query scoped to `user.id` (ownership enforced — cross-user reads/patches/deletes return 404). Shared zod contracts: `profileCreateSchema` (with defaults), a *truly* partial `profileUpdateSchema` (zod keeps `.default()` under `.partial()`, so update fields are defined without defaults — otherwise a PATCH would clobber unspecified columns), plus `SearchProfile`, `WORK_FORMATS`, `EMPLOYMENT_TYPES`. Currency uppercased + 3-letter-checked, `salaryMin ≤ salaryMax` refined.
- Web `/app/profiles`: server-rendered initial list (`serverApiGet` forwards the cookie) + client `ProfilesManager` (create/edit/delete with local state), `ProfileForm` (comma-separated tags, enum checkboxes, salary/currency), new `Badge` component; header gains Dashboard/Profiles nav.
- **Curl E2E**: create (currency `usd`→`USD`), list, partial PATCH (rename+deactivate keeps keywords), 400 on `salaryMin>salaryMax`, 401 unauthenticated, ownership 404 for another user, delete 204 then 404. **Browser E2E**: SSR list → New profile form → created card (Remote/Full-time badges, keywords, stack, `5000–8000 USD`). 83 api + 14 web tests, lint/typecheck/build clean. Version 0.2.3.
- **Next step:** vacancy feed — filters, Postgres FTS on `search_vector`, pagination (canonical vacancies only).

## 2026-07-20 — Phase 2: web foundation + auth UI

- Stood up the real web app on **Tailwind v4 + a hand-rolled shadcn/ui component set** (Button/Input/Label/Card, light/dark theme tokens). Set up the `@/*` alias in vitest too.
- Auth UI wired to the backend: `/login` + `/signup` share an `AuthForm` (client-side zod validation via the shared schemas, API error surfacing), auth-protected `/app` with a server layout that resolves the user from the session cookie (`getCurrentUser`, forwards the cookie to the API server-side) and redirects to `/login` when absent/expired; `AuthProvider` + `AppHeader` (email + logout); `middleware.ts` gates `/app` on cookie presence (no redirect loops — real check stays server-side).
- **Same-origin `/api` proxy** via Next rewrites (`API_ORIGIN`, defaults to local :3001) keeps the session cookie first-party. `SESSION_COOKIE_NAME` moved to `@jobradar/shared` (one source for api + web).
- **Live browser E2E** (in-app browser vs local API+web): `/` → `/app` → `/login` guard redirect ✓; signup → httpOnly cookie set through the proxy (`document.cookie` empty) → `/app` renders the header with the user's email ✓; logout → `/login` ✓; wrong-password login surfaces the 401 message ✓. 73 api + 10 web tests, lint/typecheck/build clean. Version 0.2.2.
- **Deploy prep (developer, when deploying the web auth):** run `pnpm db:migrate:prod` (sessions table on Neon); set `API_ORIGIN=https://jobradar-api-ptvp.onrender.com` on Vercel; set `WEB_ORIGIN` + `NODE_ENV=production` on Render (so the cookie is `secure`).
- **Next step:** search-profile CRUD (api module + web UI).

## 2026-07-20 — Phase 2: auth backend (email + password, sessions)

- Decisions (developer): **email + password** auth first (self-managed in NestJS — best fit for the "real backend / guards" learning goal and the zero-budget constraint, no external auth service); **Tailwind + shadcn/ui** for the web UI (next chunk). Cross-origin cookie problem solved by proxying `/api` through the web app (Next rewrites) so the session cookie stays first-party — routing, not backend logic, so ADR-002 holds.
- `sessions` table (opaque 256-bit token, per-user, `expires_at`) + migration `0001`; applied to local Postgres. **Prod (Neon) migration still to run before web deploy: `pnpm db:migrate:prod`.**
- Auth module: `signup`/`login`/`logout`/`me`. Passwords via Node stdlib **scrypt** (memory-hard, no native dep; had to raise `maxmem` above the 32 MB default for N=2^15). Session in an httpOnly `SameSite=Lax` cookie (`secure` in prod). `AuthGuard` + `@CurrentUser()` decorator. Login uses a constant-time dummy verify so timing doesn't leak whether an email exists.
- Shared **zod** contracts in `@jobradar/shared` (reused by web later), validated on the API through a `ZodValidationPipe`.
- Live E2E against local DB (curl + cookie jar): signup→me→logout, 401 without/after-logout cookie, 409 on duplicate email (drizzle wraps the pg error — unique-violation detected via the `cause` chain), 400 on invalid payload, 401 on wrong password. 73 api tests green, web 2, lint clean. Version 0.2.1.
- **Next step:** web foundation — Tailwind + shadcn/ui, Next `/api` proxy rewrites, login/signup pages, session context, protected app shell.

## 2026-07-20 — Phase 1 complete 🎉 (WWR replaces hh as second source)

- dev.hh.ru registration turned out to require a Russian phone number (developer has none) + an application review wait → hh deferred indefinitely per DATA_SOURCES.md "pick one of #2/#3": implemented the **WeWorkRemotely RSS worker** (fast-xml-parser, `Company: Title` split, conditional GET with 304-aware status) and activated it; hh source set inactive (worker + `HH_API_TOKEN` support stay ready).
- Local E2E: WWR 25 vacancies, dedup across 129 candidates. Prod E2E after deploy: **remoteok 100 + weworkremotely 25 vacancies in Neon, both `ok`**; hh excluded from runs.
- **Phase 1 exit criterion met** → ROADMAP marker moved to phase 2, version 0.2.0.
- **Next step:** phase 2 — auth + sessions, then search-profile CRUD.

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
