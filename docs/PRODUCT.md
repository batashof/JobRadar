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
| **Resume** | An uploaded PDF resume with server-side extracted text. Drives LLM matching, cover-letter generation, and email applications (phase 4, ADR-011). |
| **Vacancy brief** | A short on-demand, LLM-generated summary in Russian: who the employer is, what they do, how well the vacancy fits the user. Generated on button click, cached (phase 4, ADR-011). |
| **Cover letter** | On-demand, LLM-generated per vacancy: written in the vacancy's language, calibrated to the English level evident in the resume, short and focused on real experience. Editable before sending (phase 4, ADR-011). |
| **Apply contact** | An application contact (email / Telegram handle / URL) extracted from the vacancy text, shown on the vacancy page and used as the recipient of the application email (phase 4, ADR-011). |
| **Prep plan** | A resume-driven interview-prep roadmap: LLM-generated sections → topics, with per-topic progress tracking. Standalone, not tied to a specific vacancy (phase 4, ADR-013). |
| **Interview question** | An LLM-generated question for a prep topic — theory, behavioural, or coding — at a chosen difficulty; model answer generated on demand and cached (phase 4, ADR-013). |
| **Live-coding task** | A coding question the user solves in-app; the LLM reviews the submitted solution (correctness, complexity, edge cases, style) — the code is not executed (phase 4, ADR-013). |
| **Mock interview** | A turn-based text-chat rehearsal where the LLM plays the interviewer, calibrated to the resume + target role, and produces a written feedback report at the end (phase 4, ADR-013). |
| **Day plan** | An ordered queue of timeboxes for today (not a calendar), composed from real app state — due follow-ups, `todo` prep topics, fresh matching vacancies, manual tasks, and yesterday's debt. Accepted in the morning, closed in the evening (phase 4, ADR-015). |
| **Block** | One timebox in a day plan: title, category, estimate in minutes, tracked actual time, and an outcome (`done` / `partial` / `skipped` + reason). |
| **Debt** | Blocks left unfinished at day close. They roll into the next plan first, count up (`carry_count`), and can only be cleared by doing or explicitly dropping them (ADR-015). |
| **Estimation factor** | The user's personal `actual / estimate` median, shown plainly and applied to generated estimates so the plan fits the day (ADR-015). |

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
- **Apply assistant (ADR-011)**: resume PDF upload, in-app vacancy detail page, LLM resume ↔ vacancy matching, on-demand Russian vacancy brief, on-demand cover letter generation, contact extraction, email apply via Gmail (phase 4).
- Telegram bot as a second digest channel (phase 4).
- Browser extension for one-click manual saving (LinkedIn/Djinni) (phase 4).
- Additional sources: HN Who's Hiring, Djinni (phase 4). *(Telegram channels moved into v1.0 as the primary source — ADR-009.)*
- Funnel statistics (application → interview → offer conversion) (phase 4).
- **Interview-prep module (ADR-013)**: resume-driven prep plan with progress tracking, generated theory/behavioural/coding questions with on-demand model answers, LLM-reviewed live-coding (no code execution), and a text-chat mock interview with a feedback report (phase 4).
- **Day planner (ADR-015)**: LLM-composed queue of timeboxes built from app state, morning accept / evening close ritual, focus timer with estimation calibration, rolling debt, and Telegram-bot nudges with escalation (phase 4).
- Google Calendar interview sync (phase 4).
- Multi-tenancy, billing (Stripe test mode), landing page (phase 5).

## Explicitly rejected

- **Automated LinkedIn scraping** — see [decisions/003-no-linkedin-scraping.md](decisions/003-no-linkedin-scraping.md).
- **Paid infrastructure** — see [decisions/001-zero-budget.md](decisions/001-zero-budget.md).
- **hh.ru API** — dropped; needs a CIS token/IP barred by the zero-budget rule ([decisions/009-drop-hh-telegram-primary.md](decisions/009-drop-hh-telegram-primary.md)).
- **Fully automated applying** — JobRadar never contacts an employer without an explicit per-vacancy user action. *(Revised by ADR-011: user-initiated, user-confirmed email applications from the vacancy page are in scope for phase 4. In v1.0 vacancies still only link out to the original.)*

## Definition of success

1. v1.0 is deployed and used by the author in a real job search.
2. Target full-stack experience covered: auth, DB + migrations, queues, cron, email, deployment, CI/CD, monitoring.
3. The project is presentable as a resume line: README, screenshots, live link.
