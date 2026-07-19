# Architecture

## System overview

```
                       ┌────────────────────────────────────────────┐
                       │              GitHub Actions                │
                       │  (schedule: triggers ingestion every 4h)   │
                       └───────────────────┬────────────────────────┘
                                           │ HTTP (authenticated hook)
                                           ▼
┌──────────────┐   REST/JSON   ┌──────────────────────┐
│  Next.js web │ ────────────► │      NestJS API      │
│   (Vercel)   │               │       (Render)       │
└──────────────┘               │                      │
                               │  ┌────────────────┐  │      ┌─────────────────┐
                               │  │ BullMQ workers │◄─┼─────►│ Redis (Upstash) │
                               │  │  - ingest:hh   │  │      └─────────────────┘
                               │  │  - ingest:rss  │  │
                               │  │  - dedup       │  │      ┌─────────────────┐
                               │  │  - digest      │◄─┼─────►│ Resend (email)  │
                               │  └────────────────┘  │      └─────────────────┘
                               └──────────┬───────────┘
                                          │ Prisma/Drizzle
                                          ▼
                               ┌──────────────────────┐
                               │ PostgreSQL (Neon /   │
                               │ Supabase) + FTS      │
                               └──────────────────────┘

External sources: hh.ru API, RemoteOK / WeWorkRemotely (RSS/JSON),
later: HN Who's Hiring, Djinni, Telegram channels.
Monitoring: Sentry (web + api).
```

## Key architectural decisions

Each decision has a full ADR in [decisions/](decisions/):

| # | Decision | ADR |
|---|---|---|
| 1 | Zero-budget constraint: free tiers only | [001](decisions/001-zero-budget.md) |
| 2 | Backend as a separate service, not Next.js API routes | [002](decisions/002-separate-backend.md) |
| 3 | No LinkedIn scraping; browser extension instead | [003](decisions/003-no-linkedin-scraping.md) |
| 4 | Deduplication: heuristic first, LLM later | [004](decisions/004-dedup-heuristic-first.md) |
| 5 | LLM scoring via free tiers with provider failover | [005](decisions/005-llm-free-tier-failover.md) |
| 6 | External cron via GitHub Actions schedule | [006](decisions/006-github-actions-cron.md) |
| 7 | API hosting on Render free tier (Railway/Fly.io no longer free) | [007](decisions/007-api-hosting-render.md) |

## Repository layout (monorepo)

```
JobRadar/
├── apps/
│   ├── web/            # Next.js frontend
│   └── api/            # NestJS backend (REST API + BullMQ workers)
├── packages/
│   └── shared/         # Shared TypeScript types, validation schemas (zod), constants
├── docs/               # All project documentation (source of truth)
├── docker-compose.yml  # Local dev: Postgres + Redis
├── CLAUDE.md           # AI-assistant entry point
├── CHANGELOG.md        # Versions
└── README.md
```

Tooling: pnpm workspaces (+ Turborepo if build orchestration becomes painful). One lockfile, one CI pipeline.

## Stack and rationale

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Next.js on Vercel | Author's strong side; Vercel free tier; SSR available if needed |
| Backend | NestJS + TypeScript | Learning goal: real backend framework with DI, modules, guards; opinionated structure teaches good habits. Fallback option: Fastify if NestJS feels too heavy |
| Database | PostgreSQL (Neon or Supabase free tier) | Relational fits the domain; free tier; **Postgres FTS** covers full-text search without extra infrastructure |
| ORM | Prisma or Drizzle | Type-safe queries + first-class migrations (a learning goal). Final pick at phase 1 start |
| Queue / cache | Redis (Upstash free) + BullMQ | Background ingestion jobs, retries, backoff; also response caching |
| Cron | GitHub Actions schedule → HTTP hook | Free; sidesteps free-tier container sleeping (ADR-006) |
| Email | Resend, 3000 emails/mo free | Digests + reminders; generous free tier |
| Telegram | Bot API (phase 4) | Second digest channel; free |
| Hosting | Vercel (web) + Render (api) | Free tiers (ADR-007); Render free tier sleeps after 15 min — mitigated by ADR-006 cron wake-up |
| Monitoring | Sentry free tier | Errors on both web and api; alert on empty ingestion runs |
| CI/CD | GitHub Actions | Lint + typecheck + tests on PR; deploy on merge to main |

## Backend module structure (planned, NestJS)

```
apps/api/src/
├── auth/           # email+password or OAuth, sessions
├── users/
├── profiles/       # search profiles CRUD
├── sources/        # source registry and per-source config
├── ingestion/      # per-source workers: hh, rss; normalization, upsert
├── dedup/          # normalized company + fuzzy title matching
├── vacancies/      # feed API: filters, FTS, pagination
├── applications/   # kanban CRM: stages, notes, reminders
├── matching/       # vacancy ↔ profile rules
├── digest/         # daily email assembly, Resend delivery, unsubscribe
└── health/         # health-check endpoint (also used as keep-alive ping)
```

## Data flow: ingestion

1. GitHub Actions cron fires every 4 hours → authenticated HTTP call to `POST /ingestion/run`.
2. API enqueues one BullMQ job per active source.
3. Each worker fetches new items (API pagination / RSS), respecting per-source politeness rules ([DATA_SOURCES.md](DATA_SOURCES.md)).
4. Items are normalized into the common `Vacancy` shape and upserted (`source + external_id` unique key).
5. Dedup job links duplicates across sources (heuristic v1, ADR-004).
6. Matching computes `vacancy ↔ search profile` hits; digest job batches them into the daily email.

## Non-functional requirements

- **Politeness**: every source fetch is cached, rate-limited, and retried with exponential backoff. An ingestion run that yields zero items triggers a Sentry alert (likely breakage).
- **Idempotency**: ingestion and digest jobs are safe to re-run; upserts keyed on `source + external_id`; digest tracks `last_sent_at` per user.
- **Observability**: Sentry on both apps; structured logs in workers; job failures visible in BullMQ.
- **Security**: secrets only in host env vars / GitHub Actions secrets; the ingestion hook requires a shared token; standard authn/authz on user data.
