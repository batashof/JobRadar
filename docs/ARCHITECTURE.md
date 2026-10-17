# Architecture

## System overview

```
                       ┌────────────────────────────────────────────┐
                       │   Supabase pg_cron + pg_net (ADR-023)      │
                       │ (every 10 min; GitHub Actions = fallback)  │
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
                               │ PostgreSQL (Supabase │
                               │ free tier) + FTS     │
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
| 19 | Production Postgres on Supabase: always-on, no compute-hour quota; session pooler + verified TLS; prod maintenance via the `DB (prod)` workflow | [019](decisions/019-postgres-on-supabase.md) |
| 20 | Instant digest delivery: new matches pushed right after each ingestion, quiet hours, stricter floor | [020](decisions/020-instant-digest-delivery.md) |
| 21 | LinkedIn via the job-alert emails LinkedIn sends the user, read over IMAP; still no request to linkedin.com (amends 003) | [021](decisions/021-linkedin-job-alert-emails.md) |
| 24 | Telegram bot is the only client for other job seekers; accounts by `/start`, owner-only flag for LLM-per-action features; web app reduced to a static landing page in 2.0.0 | [024](decisions/024-telegram-only-product.md) |
| 25 | LLM reads the resume once at registration; vacancies scored by a pure formula + synonym dictionary for non-owners | [025](decisions/025-llm-only-at-registration.md) |
| 28 | 2.0.0 keeps the web app as the author's cabinet; public `/privacy` page; Gmail connected from the bot (`/gmail`) | [028](decisions/028-web-app-kept-as-owner-cabinet.md) |
| 29 | The owner's vacancies are scored by the formula too; no background LLM pass; the LLM reads resumes only on the delivery path | [029](decisions/029-formula-for-the-owner-too.md) |

## Architecture of 2.0.0 (phase 5)

The API stays a separate NestJS service (ADR-002). Its client changes: the Telegram bot replaces the Next.js app (ADR-024).

- **Accounts** are keyed by `users.telegram_user_id`, created by `/start`; `users.role` = `owner` | `user` gates the LLM-per-action features.
- **Dialogs** (onboarding, profile, settings) are state machines with their state in `bot_dialogs`, driven through new callback namespaces `o:` / `p:` / `s:` on the existing router.
- **Resume analysis** is the only LLM call for non-owners: one call per upload → `candidate_profiles` (ADR-025).
- **Scoring** is `matching/score.ts`, a pure function over the candidate profile and a vacancy, with a dictionary of related technologies in `packages/shared`.
- **Delivery** goes through one rate limiter for all chats.
- **`apps/web`** stays online as the author's private cabinet with no new features, plus the public `/privacy` page the bot links to (ADR-028). Removing it is a later, separate step.

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
| Database | PostgreSQL (Supabase free tier, ADR-019) | Relational fits the domain; free tier; **Postgres FTS** covers full-text search without extra infrastructure. Always-on instance with no compute-hour quota — the per-minute planner tick exhausted Neon's (ADR-019) |
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
├── applications/   # kanban CRM: stages, notes, reminders; `/applications` in the bot + hourly follow-up reminder sweep
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
└── planner/        # day plans, blocks, focus timer, estimation stats, LLM composition (+ deterministic fallback), in-process `planner:tick` scheduler (no BullMQ), Telegram-bot nudges + webhook, owner-only `/plan` in the bot
```

## Scheduling: two clocks

| Clock | Granularity | Where | Why |
|---|---|---|---|
| Ingestion tick / keep-alive | 10 min (each source on its own interval: 10 min – 4 h) | Supabase `pg_cron` + `pg_net` in the production DB (ADR-023); GitHub Actions workflows as fallback (ADR-006) | GitHub's free schedules ran every 4–5 h instead of every 10 min. The tick also keeps Render awake |
| `planner:tick` | 1 min | Plain in-process `setInterval` in the API (revised ADR-015 §7) | Minute granularity in a private repo would exceed the free Actions allowance; the 10-min keep-alive keeps the process warm. **Not BullMQ** — the tick only touches Postgres, and BullMQ's Redis polling was burning the Upstash free-tier command budget. Idempotent via DB writes (a nudge is raised once per day/block) |
| Application reminder sweep | 1 h | Plain in-process `setInterval` in the API, same pattern (`applications/application-reminders.scheduler.ts`) | "No answer for N days" follow-ups for bot users (roadmap 5.5), sent only between 10:00 and 20:00 local time. Idempotent via `applications.reminded_at`. Kill switch `APPLICATION_REMINDERS_DISABLED` |

## Telegram: two independent integrations

| Integration | Credentials | Direction | Used for |
|---|---|---|---|
| MTProto user client (ADR-009) | `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` + session string | inbound read | Ingesting job channels |
| Bot API (ADR-015) | `TELEGRAM_BOT_TOKEN` (+ `TELEGRAM_BOT_WEBHOOK_SECRET`) | outbound send + webhook | Shared `bot/` module: account linking, planner nudges with inline Start/Done/Skip, and the daily vacancy digest next |

The Bot API side is one module (`apps/api/src/bot`) with one chat link per account (`telegram_accounts`), not one per feature. Features register button handlers by `callback_data` namespace (`n:` planner nudges, `d:` digest, `a:` applying, `u:` account deletion and the owner's `/testmode` owned by the bot module itself, `p:` candidate profile, `s:` settings, `j:` applications, `i:` interview prep, `l:` the owner's `/plan`, `g:` the owner's `/gmail`), so the bot module never imports them. The namespaces are also how features avoid importing *each other*: a digest card renders an Apply button as `a:d:<vacancyId>` without knowing that outreach owns the flow behind it. Registering the webhook is a one-off deployment step: `pnpm --filter @jobradar/api bot:webhook` (`--info` / `--delete` to inspect or stop delivery). The live bot is [@JobRadarAppBot](https://t.me/JobRadarAppBot). The owner's `/testmode` (v2.3.0) parks the owner account by rewriting its `users.telegram_user_id` to `parked:<id>` and unlinking the chat, so `/start` registers a fresh `user` account from the same Telegram id; when that account is deleted, the next `/start` finds the parked row and restores it, with no schema change. The command menu (`bot/command-menu.ts`) is set with `setMyCommands` on every start: one list per language, and the owner's chat scoped to a list with the author tools.

**Accounts from the chat (ADR-024, v1.26.0).** A plain `/start` from a Telegram user the bot has never seen creates a `users` row keyed on `telegram_user_id` (no email, no password, language from the client) plus its `telegram_accounts` link, in one step. Each handler receives the account's `role`; LLM-per-action handlers refuse non-owners.

**Resumes and dialogs from the chat (ADR-025, v1.27.0).** Besides button namespaces, features register a *document handler* (one: the `candidate/` module's resume flow) and *dialog flows* (`registerDialog('profile', …)`): plain text goes to the flow whose row in `bot_dialogs` is open for that chat, so a typed skills list reaches the profile editor even after a restart. A resume PDF is downloaded with `getFile`, stored through `ResumesService`, read by one LLM call restricted to `LLM_RESUME_PROVIDERS` for non-owners, and answered with a review plus a profile card. Slow work (download, LLM) runs after the webhook has answered, like the chat Apply draft.

**Formula matching and `/settings` (ADR-025, v1.28.0).** The digest funnel is the same for everyone up to scoring: SQL pre-rank (lexical relevance, level gate, muted sources), then the `/settings` hard filters (`matching/score.ts` `passesPreferences`). Every window is then judged by `scoreVacancy` (ADR-029: the owner too, since 2.1.0), a pure function over the `candidate_profiles` row (confirmed for users; for the owner any stored row, else `fallbackProfile` from the resume text) (skills 55%, title 20%, grade 15%, freshness 10%, caps for another job family or a grade gap of two, feedback ±15 points), with the static technology dictionary in `packages/shared/src/skills.ts`. Its template explanation ("matched: React, TypeScript; missing: GraphQL; grade: Senior ✓") is the card's note. Since v2.5.0 the card head is icon rows (title; company and publication date and time; location; format and employment; salary and grade; a coloured fit dot with ✅ matched / 🟡 adjacent / ❌ missing skill rows from `ScoredCandidate.fit`), and the location filter (`digest_settings.locations`, `matchesLocation`) drops on-site and hybrid postings outside the wanted places. A digest card has one full-width button, "Apply via <board>", linking the original posting (v2.5.1: the "✅ Applied" button that shared its row cut the label on a phone and was removed; its `d:a:<vacancyId>` handler still answers presses on older cards, puts the vacancy on the applications through `ApplicationsService.markApplied` and leaves only the link, since a handler may return `editKeyboard` without `editText` to change only the buttons). Features can register slash commands (`registerCommand`); the digest module owns `/digest` and the `d:n` button at the bottom of `/settings` (v2.2.0), both a manual send over every unsent vacancy of the fortnight, run after the webhook has answered; the `candidate/` module owns `/resume` (`p:res`) and the `/setup` onboarding checklist (`p:setup`, v2.3.0), whose buttons open `s:` screens directly; the `settings/` module owns `/settings` (when: delivery, times, quiet hours, timezone, language, pause) and `/filters` (which: the candidate profile's role, grade and skills, edited through `CandidateService`, plus the hard filters; v2.4.0), both one message edited in place by `s:` buttons plus typed answers through the `settings` dialog. Every push goes through `SendLimiter` (≈30 messages/s overall, one per second per chat); a 403 unlinks the chat, which stops the digest until the next `/start`. New accounts get `digest_settings` (instant mode) and `planner_settings` (timezone by language) at sign-up. `formula:check` (also a `DB (prod)` task) compares the formula's top 20 with the LLM's on the author's resume; since ADR-029 the background LLM pass that filled `resume_matches` is gone, so it measures against the scores already collected.

**Applications in the bot (roadmap 5.5, v1.30).** For every user, not owner-only: the `applications/` module owns `/applications`, one message edited in place by `j:` buttons — the list of active applications (archive of rejected/withdrawn behind a button), a card per application with a button per stage, delete with a confirm step. Writes go through `ApplicationsService`, the same rows the web board used. An hourly in-process sweep sends a follow-up reminder for each application waiting past its threshold (pure rules in `applications/reminder-logic.ts`), with the card's stage buttons plus "⏳ Remind in N days".

**Interview prep in the bot (roadmap 5.5, owner only per ADR-024 §3).** The `interview/` module owns `/interview` (`interview-bot.service.ts`, pure screens and callback parsing in `interview-bot-logic.ts`): a menu with the topic plan's progress, the plan itself (a topic's status changed by `i:s:` buttons), questions by topic (`i:q:<topic>:<n>`: question *n* of a topic, generated three at a time when missing; model answer; "✍️ Answer it" opens the `interview` dialog so the next typed message is reviewed) and the mock interview (every typed message while its dialog is open is a reply; "🏁 Finish" produces the feedback, "⏸ Pause" closes the dialog and leaves the session resumable). Everything goes through `InterviewService`, the code the web pages used. LLM steps run after the webhook has answered: the bot posts "⏳ Thinking…" and replaces it with the result, split into ≤ 4096-character messages (`takeChunk` from `digest/render.ts`), or with a friendly error. Non-owners get a one-line refusal; `/help` lists `/interview` only for the owner.

**The day planner in the bot (roadmap 5.5, owner only).** The `planner/` module owns `/plan` (`plan-bot.service.ts`, pure rendering and parsing in `plan-bot-logic.ts`): one message edited in place by `l:` buttons. Without a plan for today it offers "✨ Compose a plan" (shows "Composing…", then `PlannerService.generatePlan`, LLM with the deterministic fallback, as a draft with "✅ Accept" / "🔄 Regenerate") and "➕ Add a block" (a typed "title, minutes" answer through the `plan` dialog flow). The plan lists blocks in order with a status icon and time; a block's card offers only the actions valid for its state (start/resume, pause, done, delete, which drops it with a recorded reason). "🌙 Close the day" asks first, then `closePlan` and shows the day's result (done vs planned, actual minutes, debt). Every action goes through `PlannerService`, so the rules are the web planner's (ADR-015). Non-owners get a one-line refusal (ADR-024 §3); `/help` lists `/plan` only for the owner. Planner nudges carry a "📋 Open plan" button (`l:m`) that sends `/plan` as a new message.

**Gmail from the bot (2.0.0, ADR-028, owner only).** `/gmail` (`outreach/gmail-bot.service.ts`) shows whether Gmail is connected, a consent link built by `GmailService.authUrl` (the user id signed into OAuth `state`) and a `g:x` disconnect button. Google redirects to the API's `GET /gmail/oauth/callback`, which stores the encrypted refresh token and answers with a small page pointing back to Telegram (`gmail-callback-page.ts`), so connecting needs no website session.

**In-process schedulers, no queue.** The planner tick (every minute), the digest runner (every five) and the application reminder sweep (hourly) are plain `setInterval`s in the API process, for the reasons in revised ADR-015 §7: all of them only touch Postgres, per-user *local* send times cannot be expressed as an external cron without firing constantly, and BullMQ's polling burned the Upstash free-tier budget. Idempotency lives in the database — `digest_settings.last_sent_key` consumes a slot exactly once, `digest_items` makes a repeat send impossible — so a restart mid-run is safe; `applications.reminded_at` does the same for reminders. Each has a `*_DISABLED` kill switch settable from the Render dashboard, and the first two an interval override.

**Per-user wall-clock time has one home.** Both time-driven features — the planner tick and the digest schedule — resolve local time in `planner_settings.timezone`; `digest_settings` deliberately stores only times, not a timezone, because two copies of it would drift. If a third consumer appears, that is the moment to promote the field to a user-level settings table rather than copy it again.

## Data flow: ingestion

1. Supabase `pg_cron` fires every 10 minutes (ADR-023; GitHub Actions as fallback) → authenticated HTTP call to `POST /ingestion/run`.
2. API enqueues one BullMQ job per active source whose own interval has elapsed (`ingestion/schedule.ts`: Telegram and LinkedIn alerts 10 min, ATS (Greenhouse, Ashby, Lever, SmartRecruiters) and WWR 1 h, the rest, DOU and Djinni RSS included, 4 h); nothing when none is due.
3. Each worker fetches new items (API pagination / RSS), respecting per-source politeness rules ([DATA_SOURCES.md](DATA_SOURCES.md)).
4. Items are normalized into the common `Vacancy` shape and upserted (`source + external_id` unique key).
5. Dedup job links duplicates across sources (heuristic v1, ADR-004).
6. Matching computes `vacancy ↔ search profile` hits; digest job batches them into the daily email.

## Non-functional requirements

- **Politeness**: every source fetch is cached, rate-limited, and retried with exponential backoff. An ingestion run that yields zero items triggers a Sentry alert (likely breakage).
- **Idempotency**: ingestion and digest jobs are safe to re-run; upserts keyed on `source + external_id`; digest tracks `last_sent_at` per user.
- **Observability**: Sentry on both apps; structured logs in workers; job failures visible in BullMQ.
- **Security**: secrets only in host env vars / GitHub Actions secrets; the ingestion hook requires a shared token; standard authn/authz on user data.
