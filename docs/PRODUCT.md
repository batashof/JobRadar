# Product

## Vision

JobRadar is a personal job-search service that removes the two most tedious parts of looking for a job:

1. **Finding relevant vacancies** — instead of manually checking multiple boards every day, background workers aggregate vacancies from friendly sources, filter them against the user's search profile, deduplicate them, and deliver a daily digest.
2. **Tracking applications** — instead of a spreadsheet, a kanban CRM tracks every application through the funnel with notes, reminders, and conversion statistics.

## Target user

- **Primary (v1.x): the author.** Frontend developer (React, 8 years) searching for remote/on-site, full-time/part-time/freelance roles in CIS and international markets. The project doubles as a full-stack learning vehicle.
- **Hypothetical (v2+): other job seekers**, via a $5–10/mo subscription. Explicitly deprioritized — see [ROADMAP.md](ROADMAP.md) phase 5. No multi-tenancy work happens before there is a real second user.

## Core concepts

| Concept | Description |
|---|---|
| **Search profile** | User-defined criteria: keywords, tech stack, work format (remote/on-site/hybrid), employment type, salary range. Used for filtering and matching. |
| **Source** | An external system vacancies are ingested from (API, RSS, Telegram). Each source has its own ingestion worker and politeness rules. |
| **Vacancy** | A normalized job posting. Deduplicated across sources (normalized company name + fuzzy title match; LLM matching later). |
| **Application** | A user's engagement with a vacancy, moving through kanban stages: Saved → Applied → Screening → Tech Interview → Offer. Carries notes and reminders. |
| **Digest** | A daily email (later also Telegram) listing new vacancies that match the search profile. |

## v1.0 scope (minimum shipped to production)

1. Authentication (email + password, or OAuth via GitHub/Google).
2. Search profile: keywords, stack, format (remote/on-site), employment type, salary range.
3. Ingestion with **Telegram job channels as the primary source** (MTProto, ADR-009) plus remote-work boards (RemoteOK JSON, WeWorkRemotely RSS) as secondary. hh.ru is dropped (ADR-009).
4. Vacancy feed with filters + Postgres full-text search; each vacancy shows its **source**, and the feed has a **platform filter (checkboxes)**. Vacancies link out to the original (Telegram: `t.me` deep link) — no in-app apply.
5. Application kanban (drag-and-drop, 5 stages, notes).
6. Daily email digest of new matching vacancies.
7. Production deployment: domain/subdomain, HTTPS, CI/CD, Sentry.

**Everything else is out of v1.0.** Rule: phase N+1 does not start until the current version is deployed.

## Out of scope for v1.0 (planned later)

- LLM relevance scoring and description summarization (phase 4).
- Telegram bot as a second digest channel (phase 4).
- Browser extension for one-click manual saving (LinkedIn/Djinni) (phase 4).
- Additional sources: HN Who's Hiring, Djinni (phase 4). *(Telegram channels moved into v1.0 as the primary source — ADR-009.)*
- Funnel statistics (application → interview → offer conversion) (phase 4).
- Google Calendar interview sync (phase 4).
- Multi-tenancy, billing (Stripe test mode), landing page (phase 5).

## Explicitly rejected

- **Automated LinkedIn scraping** — see [decisions/003-no-linkedin-scraping.md](decisions/003-no-linkedin-scraping.md).
- **Paid infrastructure** — see [decisions/001-zero-budget.md](decisions/001-zero-budget.md).
- **hh.ru API** — dropped; needs a CIS token/IP barred by the zero-budget rule ([decisions/009-drop-hh-telegram-primary.md](decisions/009-drop-hh-telegram-primary.md)).
- **In-app apply** — vacancies link out to the original; no automated responding on the user's behalf.

## Definition of success

1. v1.0 is deployed and used by the author in a real job search.
2. Target full-stack experience covered: auth, DB + migrations, queues, cron, email, deployment, CI/CD, monitoring.
3. The project is presentable as a resume line: README, screenshots, live link.
