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
| 8 | ORM: Drizzle (generated tsvector, enum arrays, light runtime) | [008](decisions/008-orm-drizzle.md) |
| 9 | Drop hh.ru; Telegram job channels as the primary source | [009](decisions/009-drop-hh-telegram-primary.md) |
| 10 | Sentry for error monitoring on both apps | [010](decisions/010-sentry-error-monitoring.md) |
| 11 | Resume-driven apply assistant: PDF in Postgres, LLM via ADR-005 gateway, email apply via Gmail API (phase 4) | [011](decisions/011-resume-apply-assistant.md) |
| 12 | Feed-centric resume-driven relevance (remove Matches page, on-demand fit gauge, soft seniority filter) | [012](decisions/012-feed-resume-relevance.md) |
| 13 | Interview-prep module: resume-driven plan, generated Q&A, LLM-reviewed live-coding, text mock interview (phase 4) | [013](decisions/013-interview-prep-module.md) |
| 14 | Two-language interface (EN/RU) stored on the account, driving UI strings and AI-generation language | [014](decisions/014-interface-language-i18n.md) |
| 15 | Day planner with accountability loop: LLM-composed timebox queue, in-process minute tick, Telegram-bot nudges, rolling debt (phase 4) | [015](decisions/015-day-planner-accountability.md) |

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
| ORM | Drizzle (ADR-008) | Type-safe queries + first-class migrations; generated tsvector and enum arrays expressible in schema; no query engine — fast cold starts |
| Queue / cache | Redis (Upstash free) + BullMQ | Background ingestion jobs, retries, backoff; also response caching |
| Cron | GitHub Actions schedule → HTTP hook | Free; sidesteps free-tier container sleeping (ADR-006) |
| Email | Resend, 3000 emails/mo free | Digests + reminders; generous free tier |
| Telegram | Bot API (phase 4) | Second digest channel; free |
| LLM | Free tiers via internal gateway (Groq / OpenRouter / Gemini, ADR-005) | Resume matching, RU vacancy briefs, cover letters, apply emails (ADR-011); interview-prep plans, Q&A, live-coding review, mock interview (ADR-013) — all on-demand only, cached (phase 4) |
| Email apply | Gmail API, OAuth `gmail.send` (phase 4, ADR-011) | Sends from the user's own account; free; recipient = contact extracted from the vacancy |
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
├── health/         # health-check endpoint (also used as keep-alive ping)
│
│   # phase 4 (ADR-011):
├── llm/            # ADR-005 gateway: ordered free providers, failover
├── resumes/        # PDF upload, text extraction, active-resume management
├── outreach/       # vacancy briefs, cover letters, Gmail OAuth + email apply
│
│   # phase 4 (ADR-013):
├── interview/      # resume-driven prep plans, generated Q&A, LLM-reviewed live-coding, text mock interview
│
│   # phase 4 (ADR-015):
└── planner/        # day plans, blocks, focus timer, estimation stats, `planner:tick` scheduler, Telegram-bot nudges + webhook
```

## Scheduling: two clocks

| Clock | Granularity | Where | Why |
|---|---|---|---|
| Ingestion / keep-alive | 4 h / 10 min | GitHub Actions (ADR-006) | Free external trigger; wakes the sleeping Render container |
| `planner:tick` | 1 min | BullMQ repeatable job inside the API (ADR-015) | Minute granularity in a private repo would exceed the free Actions allowance; the 10-min keep-alive already keeps the process warm. Tick claims nudges before sending, so restarts delay but never duplicate |

## Telegram: two independent integrations

| Integration | Credentials | Direction | Used for |
|---|---|---|---|
| MTProto user client (ADR-009) | `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` + session string | inbound read | Ingesting job channels |
| Bot API (ADR-015) | `TELEGRAM_BOT_TOKEN` (+ `TELEGRAM_BOT_WEBHOOK_SECRET`) | outbound send + webhook | Planner nudges, inline Start/Done/+15/Skip actions |

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
