# Roadmap

> **Current phase: 3 — Delivery & notifications.**
> Iron rule: **phase N+1 does not start until the current phase is deployed.** Update the marker above and tick checkboxes as work lands.

## Phase 0 — Foundation (~1 week)

- [x] Planning document, detailed docs, CLAUDE.md, GitHub repository.
- [x] Monorepo scaffold: `apps/web` (Next.js), `apps/api` (NestJS), `packages/shared`, pnpm workspaces.
- [x] Docker Compose for local dev: Postgres + Redis.
- [x] CI on PR: lint + typecheck + tests.
- [x] Deploy "hello world" of **both** apps (Vercel + Render, ADR-007) — deployment pipeline first, not last.
  - web: <https://job-radar-web-phi.vercel.app> · api: <https://jobradar-api-ptvp.onrender.com/health>

**Exit criterion:** both apps reachable over HTTPS, CI green.

## Phase 1 — Data core (~2 weeks)

- [x] Final ORM choice (Prisma vs Drizzle) — record as ADR-008.
- [x] Schema + migrations: users, search_profiles, sources, vacancies, applications, profile_matches ([DATA_MODEL.md](DATA_MODEL.md)).
- [x] Seed data.
- [x] ~~hh.ru ingestion worker~~ — **dropped (ADR-009)**. *(worker + `HH_API_TOKEN` implemented but never went live — hh geo-403s non-CIS IPs and dev.hh.ru needs a Russian phone; a CIS token/IP is barred by ADR-001. Inactive legacy code; Telegram replaces it as the primary source.)*
- [x] RSS/JSON ingestion worker (RemoteOK or WeWorkRemotely). *(both: RemoteOK JSON + WWR RSS, live in prod)*
- [x] **Telegram job-channel ingestion worker (primary source, ADR-009)**: MTProto/GramJS reads configured public channels, per-channel parse (regex first, LLM later), normalize + upsert; `t.me` deep link as the vacancy URL. Needs `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` + a stored session string (secrets). *(worker + regex parser + `telegram:session` helper shipped; skips politely until the secrets and `sources.config.channels` are set)*
- [x] Deduplication v1 (heuristic, ADR-004). *(trigram title similarity + company + 14-day window; E2E verified locally)*
- [x] GitHub Actions cron hitting the ingestion hook every 4 hours (ADR-006). *(runs no-op with a warning until Render env vars are set)*

**Exit criterion:** vacancies from two sources appear in the DB automatically, duplicates linked, deployed. ✅ *(2026-07-20: RemoteOK + WWR live in prod, 125 vacancies, cron verified)*

## Phase 2 — User & UI (~2 weeks)

- [x] Auth + sessions (email+password or GitHub/Google OAuth). *(email+password, scrypt, server-side sessions; web login/signup/logout live)*
- [x] Search profile CRUD. *(NestJS profiles module, guarded + user-scoped; web manager UI; browser E2E verified)*
- [x] Vacancy feed: filters, Postgres FTS, pagination. *(GET /vacancies: websearch_to_tsquery FTS + ts_rank, work-format/employment/salary filters, canonical-only, paginated; web feed browser — verified on 129 real vacancies)*
- [x] Feed: show **source** per vacancy + **platform filter (checkboxes)** (ADR-009). *(`sources` query filter + `GET /vacancies/sources` options endpoint; labeled source badge + checkbox filter with counts in the feed — browser E2E verified)*
- [x] Application kanban: drag-and-drop, 5 stages (+ rejected/withdrawn), ordering. *(@dnd-kit board, cross-column move persisted via reorder endpoint; save-to-board from the feed; browser E2E verified)*
- [x] Notes on applications. *(per-card notes editor, PATCH on blur)*

**Exit criterion:** the author can browse, search, and track applications in production. ✅ *(2026-07-20: deployed on Vercel + Render + Neon; prod E2E through the web proxy — signup→cookie→me, feed 128 vacancies, profile CRUD, 401 when unauthenticated — all green.)*

## Phase 3 — Delivery & notifications (~1–2 weeks)

- [x] Vacancy ↔ profile matching (rules-based). *(scorer: hard filters + keyword/stack hits with Unicode word boundaries; materialized in `profile_matches` by a `match` queue job after each ingestion cycle and on profile create/update; `GET /matches` + web Matches page — E2E verified locally)*
- [ ] ~~Daily email digest via Resend + unsubscribe link~~ — **deferred by developer decision (2026-07-20)**; revisit after v1.0. Matches are delivered in-app via the Matches page instead.
- [ ] Reminders: "no answer for N days — follow up" *(in-app, since the email digest is deferred)*.
- [ ] **Release v1.0**: domain, Sentry on both apps, README with screenshots.

**Exit criterion:** v1.0 live and used daily by the author.

## Phase 4 — Extensions (optional, after v1.0; order by appetite)

- [ ] LLM relevance scoring + description summarization (free tiers, failover — ADR-005).
- [ ] Telegram bot as second digest channel.
- [ ] Browser extension: one-click "Save to JobRadar" (covers LinkedIn/Djinni manually).
- [ ] More sources: HN Who's Hiring, Djinni. *(Telegram channels promoted to a v1.0 primary source — ADR-009.)*
- [ ] Funnel statistics: applied → screening → interview → offer conversion.
- [ ] Google Calendar sync for interviews (OAuth).

## Phase 5 — Hypothetical monetization (only if real external users appear)

- [ ] Multi-tenancy review, per-plan limits.
- [ ] Stripe in test mode (subscriptions, webhooks) — as a learning integration.
- [ ] Landing page, onboarding.

## Timeline sanity check

Phases 0–3 ≈ 6–7 calendar weeks of part-time work to v1.0. If a phase overruns by more than 2×, cut scope inside the phase rather than extending it.
