# JobRadar

> A Telegram bot for job seekers: send a resume, get matching vacancies in the chat, track applications.

**Status:** 2.0.0, the bot is the product · see [CHANGELOG.md](CHANGELOG.md)

**Live:** [@JobRadarAppBot](https://t.me/JobRadarAppBot) · [privacy policy](https://job-radar-web-phi.vercel.app/privacy) · [api /health](https://jobradar-api-ptvp.onrender.com/health) (Render free tier: the first hit after idle takes ~30–60 s)

## What it does

1. **`/start` creates the account.** No email, no password: the chat is the login.
2. **A PDF resume sent to the chat** is read once by a free LLM: the bot answers with an evaluation (strengths, gaps, what to add) and a candidate profile the user confirms with buttons.
3. **Vacancies** are collected every 4 hours from Telegram IT channels (17 across stacks), DOU, Djinni, remote boards (RemoteOK, WeWorkRemotely, Remotive, Himalayas, Jobicy, Working Nomads, HN "Who is hiring"), hh.ru and company career pages (Greenhouse, Ashby, Lever, SmartRecruiters). Each user can forward their own LinkedIn job alerts to a personal address (`/linkedin`). See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
4. **Scoring is a formula** over the profile and the vacancy (no LLM per vacancy), with a one-line explanation on each card. Delivery is instant or on a schedule, with quiet hours, a minimum score and a cap.
5. **`/settings`** holds every setting: work format, employment, salary, delivery, times, timezone, sources, language, pause.
6. **`/applications`** tracks applications: "✅ Applied" on a card adds one, buttons move it through the stages, and the bot reminds you to follow up when a company stays silent.
7. **`/privacy` and `/delete`**: what is stored, and removing the account with everything in it.

The author's account (`owner` role) also has the LLM-per-action tools: the LLM digest verdict, apply drafts with Gmail sending (`/gmail`), interview prep (`/interview`) and the day planner (`/plan`). The original Next.js web app stays online as the author's private cabinet (ADR-028); new features go only into the bot.

## Why it exists

The author is a frontend developer (React, 8 years) using this project as a path to real full-stack experience: a standalone backend with migrations, queues, cron jobs, email delivery, Docker, CI/CD, deployment, and monitoring. The secondary goal is a genuinely useful tool for the author's own job search (remote/on-site, full-time/part-time/freelance, CIS and international markets). Hypothetical monetization (a $5–10/mo subscription for other job seekers) is explicitly *not* a priority.

## Hard constraints

- **Budget: $0.** Free tiers only. The single allowed expense is a domain (~$10/year), and even that is optional.
- **No LinkedIn scraping.** Anti-bot measures make it a permanent war not worth fighting. Compensated by a browser extension for one-click manual saving (phase 4).
- **Gentle scraping everywhere else:** API/RSS-first sources, runs every few hours, caching, no proxies.

## Stack

| Layer | Choice |
|---|---|
| Client | Telegram bot (webhook into the API); Next.js on Vercel for the privacy page and the author's cabinet |
| Backend | NestJS + TypeScript (separate service) on Render |
| Database | PostgreSQL (Supabase free tier, ADR-019) + Postgres FTS |
| ORM | Drizzle, with migrations (ADR-008) |
| Queue / cache | Redis (Upstash free) + BullMQ |
| Cron | GitHub Actions schedule → authenticated ingestion hook (ADR-006) |
| Sources | Telegram MTProto (GramJS), RSS and public JSON APIs, IMAP for LinkedIn alerts |
| Monitoring | Sentry free tier, both apps (ADR-010) |
| CI/CD | GitHub Actions (lint + typecheck + tests) |

Full rationale for each choice: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/decisions/](docs/decisions/).

## Development

Requirements: Node.js ≥ 22, pnpm ≥ 11, Docker (Docker Desktop, OrbStack, or colima).

```bash
# infrastructure (Postgres 17 + Redis 8)
cp .env.example .env      # once
docker compose up -d      # start; `docker compose ps` shows health
docker compose down       # stop (add -v to also drop data volumes)

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
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Database entities and relationships |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | Every ingestion source: API details, limits, politeness rules |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phase-by-phase implementation plan with checklists |
| [docs/RISKS.md](docs/RISKS.md) | Known risks and mitigations |
| [docs/decisions/](docs/decisions/) | Architecture Decision Records (ADRs) |
| [docs/WORKLOG.md](docs/WORKLOG.md) | Chronological log of work done |
| [docs/original-plan.ru.md](docs/original-plan.ru.md) | The original planning document (Russian) |

## Definition of success

- v1.0 is deployed and actually used by the author in a real job search.
- The target full-stack experience is covered: auth, DB + migrations, queues, cron, email, deploy, CI/CD, monitoring.
- The project works as a resume line: a README and a live bot anyone can try.
