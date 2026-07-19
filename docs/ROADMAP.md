# Roadmap

> **Current phase: 1 — Data core.**
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
- [x] hh.ru ingestion worker: fetch, normalize, upsert. *(implemented + unit-tested; live fetch blocked from dev machine by hh geo-403 — verify from Render or add hh app token)*
- [x] RSS/JSON ingestion worker (RemoteOK or WeWorkRemotely). *(RemoteOK; verified E2E locally — 100 vacancies ingested)*
- [ ] Deduplication v1 (heuristic, ADR-004).
- [ ] GitHub Actions cron hitting the ingestion hook every 4 hours (ADR-006).

**Exit criterion:** vacancies from two sources appear in the DB automatically, duplicates linked, deployed.

## Phase 2 — User & UI (~2 weeks)

- [ ] Auth + sessions (email+password or GitHub/Google OAuth).
- [ ] Search profile CRUD.
- [ ] Vacancy feed: filters, Postgres FTS, pagination.
- [ ] Application kanban: drag-and-drop, 5 stages (+ rejected/withdrawn), ordering.
- [ ] Notes on applications.

**Exit criterion:** the author can browse, search, and track applications in production.

## Phase 3 — Delivery & notifications (~1–2 weeks)

- [ ] Vacancy ↔ profile matching (rules-based).
- [ ] Daily email digest via Resend + unsubscribe link.
- [ ] Reminders: "no answer for N days — follow up".
- [ ] **Release v1.0**: domain, Sentry on both apps, README with screenshots.

**Exit criterion:** v1.0 live and used daily by the author.

## Phase 4 — Extensions (optional, after v1.0; order by appetite)

- [ ] LLM relevance scoring + description summarization (free tiers, failover — ADR-005).
- [ ] Telegram bot as second digest channel.
- [ ] Browser extension: one-click "Save to JobRadar" (covers LinkedIn/Djinni manually).
- [ ] More sources: HN Who's Hiring, Djinni, Telegram channels.
- [ ] Funnel statistics: applied → screening → interview → offer conversion.
- [ ] Google Calendar sync for interviews (OAuth).

## Phase 5 — Hypothetical monetization (only if real external users appear)

- [ ] Multi-tenancy review, per-plan limits.
- [ ] Stripe in test mode (subscriptions, webhooks) — as a learning integration.
- [ ] Landing page, onboarding.

## Timeline sanity check

Phases 0–3 ≈ 6–7 calendar weeks of part-time work to v1.0. If a phase overruns by more than 2×, cut scope inside the phase rather than extending it.
