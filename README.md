# JobRadar

> Personal job-search service: a vacancy aggregator with a built-in application-tracking CRM.

**Status:** phase 0 — foundation (monorepo scaffolded) · **Version:** 0.0.2 · see [CHANGELOG.md](CHANGELOG.md)

## What it is

JobRadar combines two tightly coupled parts:

1. **Aggregator** — background workers regularly collect vacancies from scraping-friendly sources (official APIs, RSS feeds, Telegram channels), filter them against the user's search profile, deduplicate them, and deliver a digest.
2. **Application CRM** — a kanban board for managing the job-search funnel: saved vacancy → applied → screening → tech interview → offer. With per-company notes, reminders, and conversion statistics.

## Why it exists

The author is a frontend developer (React, 8 years) using this project as a path to real full-stack experience: a standalone backend with migrations, queues, cron jobs, email delivery, Docker, CI/CD, deployment, and monitoring. The secondary goal is a genuinely useful tool for the author's own job search (remote/on-site, full-time/part-time/freelance, CIS and international markets). Hypothetical monetization (a $5–10/mo subscription for other job seekers) is explicitly *not* a priority.

## Hard constraints

- **Budget: $0.** Free tiers only. The single allowed expense is a domain (~$10/year), and even that is optional.
- **No LinkedIn scraping.** Anti-bot measures make it a permanent war not worth fighting. Compensated by a browser extension for one-click manual saving (phase 4).
- **Gentle scraping everywhere else:** API/RSS-first sources, runs every few hours, caching, no proxies.

## Stack (planned)

| Layer | Choice |
|---|---|
| Frontend | React + Next.js |
| Backend | NestJS + TypeScript (separate service) |
| Database | PostgreSQL (Neon/Supabase free tier) + Postgres FTS |
| ORM | Prisma or Drizzle, with migrations |
| Queue / cache | Redis (Upstash free) + BullMQ |
| Cron | GitHub Actions schedule |
| Email | Resend (3000 emails/mo free) |
| Hosting | Vercel (front) + Railway/Fly.io (back) |
| Monitoring | Sentry free tier |
| CI/CD | GitHub Actions |

Full rationale for each choice: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/decisions/](docs/decisions/).

## Development

Requirements: Node.js ≥ 22, pnpm ≥ 11.

```bash
pnpm install
pnpm build       # builds packages/shared, apps/api, apps/web
pnpm dev         # runs web (http://localhost:3000) and api (http://localhost:3001) in watch mode
pnpm lint
pnpm typecheck
pnpm test
```

Note: `packages/shared` is consumed from its `dist/` output — run `pnpm build` (or `pnpm --filter @jobradar/shared build`) once before the first `pnpm dev`.

Monorepo layout: `apps/web` (Next.js), `apps/api` (NestJS), `packages/shared` (shared types/constants) — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation map

| Document | Contents |
|---|---|
| [CLAUDE.md](CLAUDE.md) | AI-assistant entry point: context rules, worklog & versioning conventions |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Product vision, target user, v1.0 scope, success criteria |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, repo layout, stack rationale |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Database entities and relationships (draft) |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | Every ingestion source: API details, limits, politeness rules |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phase-by-phase implementation plan with checklists |
| [docs/RISKS.md](docs/RISKS.md) | Known risks and mitigations |
| [docs/decisions/](docs/decisions/) | Architecture Decision Records (ADRs) |
| [docs/WORKLOG.md](docs/WORKLOG.md) | Chronological log of work done |
| [docs/original-plan.ru.md](docs/original-plan.ru.md) | The original planning document (Russian) |

## Definition of success

- v1.0 is deployed and actually used by the author in a real job search.
- The target full-stack experience is covered: auth, DB + migrations, queues, cron, email, deploy, CI/CD, monitoring.
- The project works as a resume line: README with screenshots and a live link.
