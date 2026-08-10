# Changelog

All notable changes to JobRadar are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

- Phase 4 remainder: the digest send itself (funnel, cron, apply buttons), browser extension, calendar sync.

## [1.17.0] — 2026-08-10

**The bot is live, and the digest has a schedule.** [@JobRadarAppBot](https://t.me/JobRadarAppBot) exists and is wired up; this release adds the knob that decides when its main payload arrives.

### Added

- **Digest schedule** (`digest_settings`, migration `0012`): on/off, **1–4 send times a day** as wall-clock `HH:MM`, a **per-send cap** of up to 10 vacancies, and a **resume-fit floor** in percent. The number of send times *is* the number of pushes a day, so there is no separate frequency control that could contradict the schedule.
- `GET` / `PATCH /digest/settings`, and a card on the day surface next to the Telegram connection.

### Changed

- Times are resolved in `planner_settings.timezone` rather than a second copy on the digest row — per-user timezone already exists there (ADR-015 §7), and two copies would drift. The API echoes it read-only so the UI can say which zone it means.

### Notes

- The digest **does not send yet** — that is the next increment (funnel, cron, Telegram cards with an Apply button). What ships here is the configuration it will read.
- Bot commands and descriptions were registered with BotFather in both languages.

## [1.16.0] — 2026-08-10

**A Telegram bot channel.** JobRadar can now reach the phone. This is the shared plumbing — account linking, outbound messages, inline buttons — built as its own module rather than inside the planner, because the daily vacancy digest needs exactly the same channel and a second bot would mean a second chat for the same person. The first user of it is the day planner, whose nudges have been in-app only since v1.10.0.

### Added

- **`bot/` module (Bot API, ADR-015 §6).** Hand-rolled `fetch` client (`sendMessage` / `editMessageText` / `answerCallbackQuery` / `getMe` / `setWebhook`) — four methods do not justify a bot framework under ADR-001. Entirely optional: with no `TELEGRAM_BOT_TOKEN` the service reports itself unconfigured and every send is a no-op, exactly like Gmail and Sentry.
- **Account linking by deep link.** *Connect Telegram* on the day surface issues a single-use `t.me/<bot>?start=<token>` link (15-minute TTL); pressing Start in the bot completes it. One chat per account, in the new `telegram_accounts` table, shared by every feature — no chat id to look up and paste.
- **Planner nudges over Telegram**, on the same `planner_nudges` rows. Block nudges carry *Start* / *Done* / *Skip*, day-scoped ones an ack; every button goes through `PlannerService`, so the phone path enforces the same rules as the web one and a one-tap skip still records a reason. Escalations resend rather than edit, because the point is a new notification.
- **`POST /bot/telegram/webhook`**, guarded by Telegram's secret-token header, with button routing by `callback_data` namespace so features plug in without the bot module importing them.
- **`bot:webhook` script** to register, inspect (`--info`) or stop (`--delete`) webhook delivery, and `botConfigured` in `GET /health`.

### Changed

- `planner_settings.telegram_chat_id` dropped (migration `0011`): the chat link is account-wide now, and two sources of truth for it would drift. `telegram_enabled` stays as the planner's own opt-in.
- A user who blocks the bot is unlinked on the first `403` instead of being retried on every tick.

## [1.15.1] — 2026-07-29

**The web app survives an API outage.** Every signed-in page is server-rendered from the API, and those fetches had no deadline and no error boundary above them. When the Render instance stopped answering, the Vercel function hung until the platform killed it and served a raw `504 FUNCTION_INVOCATION_TIMEOUT` page. The app now fails fast and explains itself.

### Fixed

- **Deadline on every server-side API call** (20s, comfortably under the function limit) in `serverApiGet` and `getCurrentUser`, so the app times out before Vercel does.
- **Error boundaries** at the root and `/app` segments. They probe `/api/health` from the browser to tell an API outage apart from an application bug, and show the matching explanation with a retry — in the account language, read from the `jr_lang` mirror cookie (no provider needed, since the failing layout is what provides it).
- **An unreachable API no longer looks like a logged-out session.** `getCurrentUser` threw away the distinction by returning `null`, which sent a signed-in user to a login page that was equally broken; it now throws `ApiUnavailableError`.
- **An unreachable API no longer looks like a missing vacancy.** The vacancy detail page caught *every* error and rendered not-found; only a real 404 does now.

## [1.15.0] — 2026-07-28

**Company career pages as a source.** JobRadar now reads job boards straight from companies' applicant tracking systems — Greenhouse, Ashby and Lever — for a curated list of 36 remote-friendly tech companies (GitLab, Cloudflare, Stripe, Mozilla, Supabase, Vanta, Vercel, Spotify, …). This is the highest-quality data in the pipeline: it comes from the employer rather than an aggregator, so there is no boilerplate, no scraped page and no stale reposting. Measured on the live boards: **~1500 remote engineering vacancies** with full 4–12 KB descriptions.

### Added

- **`ats` source** with one adapter per ATS, all public and unauthenticated. Ashby contributes a compensation range and employment type, Lever an employment type.
- Company list lives in `sources.config.companies` as `{ ats, token, name }` — adding a company is a one-line config change, no code.

### Notes

- Every board mixes engineering with sales/HR and remote with onsite, so both filters are applied per adapter. Ashby's `isRemote` flag is deliberately **not** used: boards set it on hybrid roles too (OpenAI reports 475 "remote" postings, 446 of which are `workplaceType: Hybrid`) — only `workplaceType` is trusted, falling back to the location string when absent.
- A board that 404s (renamed token, acquisition) is logged and skipped; only a run where every board fails marks the source errored.

## [1.14.0] — 2026-07-28

**Hacker News "Who is hiring?" as a source, and a wider Jobicy.** The monthly HN thread is now ingested: ~150 remote/hybrid vacancies per thread, with company, role, location, employment type and salary parsed out of the community's pipe-header convention. Jobicy gains the cybersecurity and QA/testing industries.

### Added

- **HN source** (`hn`) — finds the `Ask HN: Who is hiring?` threads through the Algolia HN search API and reads their comments in bulk (5 requests instead of ~450 via the Firebase API). Walks two threads so the feed does not empty out on the 1st of the month. Onsite-only posts are dropped (this is a remote-work radar), as are posts whose header names no role.
- `ingestion/salary.ts` — the free-form salary parser, shared by Remotive and HN. Now also rejects **monthly/weekly/daily** rates, not just hourly, so `$3.5k/mo` no longer lands in the annual salary filters.
- Jobicy feeds for `cybersecurity` and `qa-testing` (~50 more IT postings per run).

### Changed

- `parseRemotiveSalary` is an alias of the shared `parseSalaryString`; behaviour is unchanged apart from the non-annual-rate fix above.

## [1.13.0] — 2026-07-28

**Clean vacancy text and a better board mix (ADR-016).** Job-board descriptions no longer carry cookie banners or the *"Please mention the word \*\*AMICABILITY\*\* and tag …"* anti-spam footers, and items whose whole body was that boilerplate are not ingested at all. RemoteOK is deactivated — its free API turned into a scraped web index with no IT vacancies in it — and the lost volume is more than replaced by WeWorkRemotely's five category feeds, a second Jobicy industry, and Himalayas as a new source.

### Added

- `ingestion/description.ts` — the shared sanitizer every board worker uses: named/numeric/double-encoded entity decoding, Latin-1/CP1252 mojibake repair (`Â£45k` → `£45k`), board-boilerplate removal, and a `MIN_DESCRIPTION_LENGTH` (200) quality gate applied in each worker's item predicate.
- **Himalayas** source (`https://himalayas.app/jobs/api`) — richest free feed available: annual salary, seniority, employment type, location restrictions. Paged (10 × 20 items/run) with a client-side tech filter, since the API has no category filter.
- Multi-feed support for WeWorkRemotely (`feedUrls`: programming, full-stack, back-end, front-end, devops-sysadmin) and Jobicy (`dev` + `data-science`), both deduping across feeds; WWR reports `notModified` only when *every* feed returns 304.
- `pnpm --filter @jobradar/api cleanup:junk [--prod] [--dry-run]` — one-off cleanup of rows ingested before the sanitizer; never deletes a vacancy with an application or an outreach draft.

### Changed

- RemoteOK: `is_active = false` (worker and config kept, reversible). Re-run `db:seed` to apply.
- All five board normalizers drop their private `stripHtml` in favour of `cleanDescription()`; entities like `&#39;` are now decoded instead of blanked.

## [1.12.0] — 2026-07-27

**Hide vacancies from the feed (manual filtering).** Each feed card gets a Hide button next to Save; hidden vacancies drop out of the feed immediately. A "Show hidden" checkbox (with a count) brings them back, where each shows an Unhide control. Hidden state is per-user and persistent.

### Added

- `hidden_vacancies` table (migration `0010`) — per-user mute list. Apply to prod with `db:migrate:prod`.
- API: `GET /vacancies/hidden`, `POST /vacancies/:id/hide`, `DELETE /vacancies/:id/hide`; feed query gains `includeHidden` (default false, excludes hidden via `NOT EXISTS`).
- Web: Hide/Unhide button on `VacancyCard`, "Show hidden" toggle in the feed, `vacancy.hide*` / `feed.showHidden` i18n strings (EN/RU).

## [1.11.0] — 2026-07-27

**Per-criterion resume-fit breakdown.** "How well it fits me" now scores four criteria separately — Technologies & stack, Role & direction, Experience & level, Location & logistics — each with its own percentage and a one-line note, rendered as colored bars under the overall gauge. The overall score is a **weighted average** computed on the backend (`stack` 0.40, `role` 0.25, `experience` 0.20, `location` 0.15 — technologies weigh the most, per the developer's request), so "tech first" holds regardless of the model. Location logic from 1.10.6 folds into its own criterion.

### Added

- `resume_matches.breakdown` / `breakdown_en` (jsonb, nullable) — per-criterion cache per language (migration `0009`). Apply to prod with `db:migrate:prod`.
- `MatchBreakdown` component + `detail.fitDim.*` / `detail.fitOverall` i18n strings (EN/RU).

### Changed

- Resume-match prompt asks for `{stack,role,experience,location,summary}`; `parseResumeMatchReply` returns `{score, explanation, breakdown}` and still accepts the legacy flat `{score, explanation}` shape, so existing cached rows keep working (they render as the overall gauge only). `maxTokens` raised 300 → 500 for the larger reply.

## [1.10.6] — 2026-07-27

**Location awareness in "How well it fits me".** The resume ↔ vacancy fit score (ADR-011) now weighs where the candidate is (from the resume text) against the vacancy location and employer country. Even for remote roles the model judges whether the employer could realistically work with a candidate from that location — sanctions or legal/payment barriers between the two countries, an incompatible timezone, or an on-site/relocation requirement — lowers the score and names the barrier in the explanation. Unknown locations or openly global-remote roles are not penalized.

### Changed

- **Resume-match prompt.** `ResumeMatchVacancy` gained an optional `location`; the vacancy location is now passed into the prompt (both languages) and the batch candidate query selects it. No output-shape change — still `{score, explanation}`.

## [1.10.5] — 2026-07-27

**Fix: drop non-vacancy noise from Telegram at ingestion.** Anti-spam bot notices ("тебя заблокировали (Lols Ban)"), giveaways and ads passed the length-only `isLikelyVacancy` gate and surfaced as fake vacancies. Added a deny-list to `isLikelyVacancy` (moderation-bot bans, giveaways/repost contests, ads) so junk is rejected before it hits the DB. Deny-list only — no positive-signal requirement, since genuine channel posts are free-form (ADR-009) and easy to reject by accident. Cyrillic word boundaries use Unicode lookarounds (JS `\b` is ASCII-only even with `/u`). Off-profile vacancies (e.g. QA leaking into a frontend feed) are intentionally out of scope here — that's a matching, not an ingestion, concern.

### Changed

- **Telegram ingestion.** `isLikelyVacancy` now rejects known junk shapes via `isJunkPost`; short-post length gate unchanged.

## [1.10.4] — 2026-07-24

**One more Telegram channel (freelance).** Probed freelance-oriented candidates over MTProto; most were dead archives, marketing/content boards or spam, so only one clean IT channel was added.

### Changed

- **Telegram sources.** Added `FreeVacanciesIT` (IT freelance/contract postings — Full Stack, Android/AOSP, Go/Java/Python backend, DevOps, Data Engineer), for 7 channels total. Rejected freelance candidates: dead archives (`freelance_projects` 2019, `Remotelist` / `freelance_zakaz` 2023), non-dev marketing/content boards (`Koteyka_Freelancer`, `jobforfreelance`, `digitalbroccoli`) and spam (`kwork`). Applied to prod via `db:migrate:prod`.

## [1.10.3] — 2026-07-24

**Fix: cut the ingestion worker's idle Redis polling.** With the planner off Redis (1.10.1), the remaining Upstash consumer was the ingestion BullMQ worker, which polled Redis on the defaults (`drainDelay` 5s, `stalledInterval` 30s) 24/7 — roughly 20k commands/day for jobs that arrive at most every 4h (ADR-006). Raised `drainDelay` to 60s and `stalledInterval` to 5min on the ingestion processor: about 12× fewer idle commands (~20k/day → ~2k/day), with no added latency for real jobs (a newly enqueued job still wakes the blocking pop immediately). Verified in prod that 1.10.2 was live and the planner is off Redis, so this is the last steady consumer.

## [1.10.2] — 2026-07-24

**Ops safety for the planner tick.** Follow-up to the 1.10.1 Upstash fix.

### Added / changed

- **Kill switch**: `PLANNER_TICK_DISABLED=1` stops nudges and auto-close entirely with no deploy — set it in the Render dashboard if the tick ever needs to be off.
- **Configurable pace**: `PLANNER_TICK_INTERVAL_MS` overrides the 60s interval (min 10s), so it can be relaxed without shipping code.
- **Truthful `/health` version**: `apps/api/package.json` was stuck at 1.4.0, so `GET /health` under-reported the deployed version; it is now synced with the release version, making deploys verifiable at a glance.

## [1.10.1] — 2026-07-23

**Fix: `planner:tick` no longer uses BullMQ/Redis.** The tick shipped in 1.10.0 on a BullMQ repeatable job; BullMQ's continuous worker polling reached ~247k of the 500k monthly Upstash free-tier command budget within days. The tick only ever reads and writes Postgres, so the queue added no safety. It now runs on a plain in-process `setInterval` (lifecycle-managed, non-overlapping, failure-isolated) — zero Redis commands, same idempotency guarantees, same behaviour. Ingestion keeps using BullMQ, which its jobs genuinely need. Revised ADR-015 §7; risk #8 in docs/RISKS.md updated.

## [1.10.0] — 2026-07-23

**Day planner, increment 4a (ADR-015): the tick and in-app nudges.** The planner now has its own clock; the Telegram channel is the only piece still missing.

### Added

- **`planner:tick`** — a BullMQ repeatable job running every minute inside the API (ADR-015 §7, deliberately not GitHub Actions). Registered idempotently on boot; a Redis outage logs and never blocks bootstrap.
- **Automatic end-of-day close**: a day nobody closed is closed by the tick with everything unresolved recorded as `skipped` / `unreported` and `auto_closed = true` — which is what finally turns yesterday's leftovers into today's debt without any user action.
- **Nudges** written to `planner_nudges` and delivered in-app: `morning` (day not taken on), `debt` (leftovers from earlier days), `block_start` (accepted day, nothing running), `midway` (a block past 1.5× its corrected estimate), `evening` (review time, day still open). Each is raised at most once per day, or once per block.
- **Bounded escalation**: an unacknowledged nudge repeats every `escalation_after_minutes` up to `escalation_max_repeats`, then is recorded as `ignored` and stops. The record of ignoring is the point, not an unmutable alarm.
- `GET /planner/nudges`, `POST /planner/nudges/:id/ack`, nudges included in `GET /planner/today`, and a banner list with a "Got it" action on the day page (EN + RU).

### Notes

- Delivery is in-app only; the same rows feed the Telegram bot once a `TELEGRAM_BOT_TOKEN` exists (increment 4b).
- New risk logged in docs/RISKS.md: the minute tick consumes Upstash free-tier commands — watch it in production.

## [1.9.0] — 2026-07-23

**Day planner, increment 3 (ADR-015): the assistant composes the day.** `POST /planner/plans/generate` turns the SQL-collected candidates into an ordered, capacity-fitting draft.

### Added

- **LLM composition**: the model receives the candidate list plus the day's capacity, the estimation factor and the day's intent, and returns an ordered selection with per-block titles and estimates. It **selects and sequences only** — any key it did not receive is dropped on parse, so the planner can never invent work.
- **Deterministic fallback**: with no LLM key, a failing gateway or an unusable answer, composition falls back to a fixed priority order (debt, rotting first → follow-ups → prep topics → courses → vacancies). The plan surface shows which of the two produced it.
- **Capacity guard on both paths**: blocks are kept while they fit the capacity measured in corrected minutes, capped at 6 blocks a day; the first block is always kept.
- **Idempotent per day**: generating over an existing plan needs an explicit `regenerate`, and even then only untouched blocks (pending, never started, no time banked) are replaced — anything started or resolved survives.
- The result is a **draft**: the morning accept ritual is unchanged.
- Web: "Compose the day for me" on an empty day, "Rebuild the untouched blocks" on a draft, and a badge naming the composer.

## [1.8.0] — 2026-07-23

**Day planner, increment 2 (ADR-015): focus timer, evening close-out, real estimation factor.** The day surface now measures what actually happens instead of only what was planned.

### Added

- **Focus timer**: start / pause / resume per block, recorded as `focus_sessions` rows and banked onto the block's `actual_minutes`. At most one session runs per user — starting a second block pauses the first one automatically. The queue shows a live `elapsed / estimate` counter.
- **Block outcomes**: `done` / `partial` / `skipped` with a required reason for anything short of done, plus an optional note. `partial` and `skipped` keep the block owing work, which is what turns it into tomorrow's debt.
- **Evening close-out** (`POST /planner/plans/:id/close`): anything still unresolved is recorded as `skipped` with the `unreported` reason, the day's review (blocks done, planned vs actual minutes, minutes per category, debt created) is stored on the plan, and the day is locked — no timer, no suggestions, no new blocks.
- **Estimation factor computed for real**: median `actual / estimate` over the last 20 timed blocks, globally and per category, recomputed at close. It stays at ×1.00 until at least 5 timed blocks exist and is clamped to [0.5, 4] so one freak block cannot distort the plan. New blocks are corrected by it, and capacity is checked against the corrected estimate.
- **Live review preview** before closing, so the cost of closing is visible in advance.

### Notes

- LLM plan composition and Telegram nudges are still ahead (increments 3–4); `planner:tick` remains unscheduled, so an unclosed day is not auto-closed yet.

## [1.7.0] — 2026-07-23

**Day planner, increment 1 (ADR-015).** A new `/app/day` surface: an ordered queue of timeboxes for today — deliberately not a calendar — assembled by hand from candidates collected out of the app's own data.

### Added

- **Schema (migration `0008`)**: `planner_settings`, `day_plans`, `plan_blocks`, `focus_sessions`, `planner_nudges`. The full ADR-015 shape lands at once (timer, close-out and nudge columns included) so later increments never have to migrate the stored data again.
- **Candidates, plain SQL, no LLM**: unfinished blocks from earlier days (debt), applications past their follow-up threshold, open topics of the active interview-prep plan, and profile-matched vacancies that are not on the board yet. Titles are generated in the account language (ADR-014) because a planned block persists its title as text.
- **Manual day plan**: start today's plan, add blocks from candidates or by hand, edit estimates, reorder the queue, set the day's intent.
- **Morning ritual**: the plan starts as a draft and has to be explicitly accepted; a day that is never accepted counts as unplanned.
- **Debt handling**: candidates carry a `carriedFromBlockId` backlink and a carry counter; a block carried three times is marked as rotting. Dropping a block is recorded with a reason instead of deleting the row.
- **Estimation factor**: estimates are stored both raw and corrected by the user's personal `actual / estimate` factor; capacity is checked against the corrected value. The factor stays 1 until the timer increment starts producing actuals.
- **Per-user timezone**, with a one-click "use device timezone" prompt when the browser and the planner disagree.

### Notes

- No focus timer, evening close-out, LLM composition or Telegram nudges yet — those are increments 2–4 of ADR-015.
- `planner:tick` is not scheduled yet; nothing runs in the background.

## [1.6.0] — 2026-07-22

**Two-language interface (English / Russian).** A user-controlled language, stored on the account, now drives both the whole UI and the language the AI sections generate in — an interface in Russian produces a Russian brief and fit rationale; in English, English (ADR-014).

### Added

- **Account language** — new `users.language` column (`'en' | 'ru'`, default `'ru'`), exposed on `AuthUser` and updatable via `PATCH /auth/me`. A `jr_lang` cookie mirrors it so server components (incl. pre-auth `/login` and `/signup`) render the right language.
- **Web i18n layer** — isomorphic `lib/i18n` dictionaries (flat keys, `ru` typed against `en` so they can't drift), an `I18nProvider` + `useI18n()` client context, a `getServerT()` server helper, and an EN/RU switcher in the header (and on the auth pages). Switching is optimistic, persists to the account, and refreshes server components. The entire interface — nav, dashboard, feed, board, profiles, resume, interview, mock interview, apply-email, and both vacancy-detail assistant sections — is translated.
- **Bilingual AI generation** — `buildBriefPrompt` and `buildResumeMatchPrompt` gained English variants; generation language follows the caller's account language. The brief is cached per language on the vacancy row (`summary_en` alongside `summary_ru`); the resume-fit score is generated once and its rationale cached per language (`resume_matches.explanation_en` alongside `explanation`).

### Changed

- `BriefResponse.summaryRu` / `VacancyDetail.summaryRu` renamed to `summary` — the field now carries the brief in the requested language.
- Work-format / employment-type / application-stage / interview-status labels moved from fixed English maps into the i18n dictionaries; source brand names stay as-is.

### Notes

- Migration `0007` adds `users.language`, `vacancies.summary_en`(+`_generated_at`), and `resume_matches.explanation_en`. Apply to prod with `db:migrate:prod`.
- End-to-end verified locally: pre-auth and authenticated UI switch instantly, the language persists to the account (DB confirmed), and both priority sections flip with the toggle.

## [1.5.0] — 2026-07-21

**Three more job platforms.** Added Remotive, Jobicy and Working Nomads as ingestion sources — all free, public, no-auth JSON feeds that fit ADR-001 (budget $0) and the API-first politeness rules.

### Added

- **Remotive** (`remotive`, JSON): `https://remotive.com/api/remote-jobs?category=software-dev`. The server-side category filter is unreliable, so the worker keeps only a tech-category allowlist client-side. Free-form salary strings are parsed for clear *annual* figures only (hourly rates stay null); `contract`/`freelance` fold into the `freelance` employment enum.
- **Jobicy** (`jobicy`, JSON v2): `https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50`. `industry=dev` scopes to software roles; `jobType` maps to the employment enum.
- **Working Nomads** (`workingnomads`, JSON): `https://www.workingnomads.com/api/exposed_jobs/`. Freelance-leaning aggregator (Lemon.io etc.); the worker keeps only the `Development` category. External id is the trailing numeric id in the job URL.
- Each source has its own normalizer + service + unit tests, is registered in the ingestion processor/module, seeded (active) in `seed-data`, and labeled in the web feed's source filter.

### Notes

- Dedicated freelance marketplaces (Upwork, Freelancer, Fiverr, Toptal) were evaluated and rejected: none offer a free open API (all gate behind OAuth + approval and forbid scraping), which conflicts with ADR-001 and the spirit of ADR-003. Freelance/contract coverage instead comes from the `job_type`/`jobType` fields of Remotive/Jobicy and from Working Nomads.
- Live-verified against the real feeds (2026-07-21): Remotive 41→20 kept, Jobicy 50→50, Working Nomads 38→23.

## [1.4.1] — 2026-07-21

**More Telegram job channels.** Broadened Telegram coverage from 3 to 6 channels after probing candidates for reachability, post frequency and vacancy-vs-noise ratio.

### Changed

- **Telegram sources.** Added `rabotafrontend` (frontend), `golang_jobs` (Go/backend) and `qa_jobs` (QA) to the existing `job_react` / `geekjobs` / `remote_it_jobs`. Candidates that were resume feeds, spam/discussion chats, dead archives or non-dev boards (marketing, gamedev, HR) were rejected during probing. Applied to prod via `db:migrate:prod`; `seed-data` test now guards channel usernames.

## [1.4.0] — 2026-07-21

**Mock interview (ADR-013, interview-prep increment 2).** A text-chat rehearsal with an AI interviewer at `/app/interview/mock`, completing the interview-prep module.

### Added

- **Mock interview.** `POST /interview/sessions` starts a session — the LLM interviewer opens with a question grounded in the active resume and optional target role/seniority. `POST /interview/sessions/:id/reply` records the candidate's answer and returns the interviewer's reactive follow-up; the full turn-by-turn `transcript` is persisted in `interview_sessions`. `POST /interview/sessions/:id/finish` ends the interview and generates a written feedback report (summary, strengths, gaps, recommendation, 0–100 score). `GET /interview/sessions/active` resumes an in-progress session.
- **Chat UI.** `/app/interview/mock`: start form, interviewer/candidate chat bubbles, an answer box, "Finish & get feedback", and a feedback card with a score gauge. Linked from the prep-plan workspace.
- **Schema.** Migration `0006`: `interview_sessions` table + `interview_session_status` enum — completing the ADR-013 data model.

## [1.3.0] — 2026-07-21

**Interview-prep module, first increment (ADR-013).** A standalone, resume-driven prep workspace at `/app/interview`, reusing the existing LLM gateway (ADR-005) and resumes — no new service or infrastructure.

### Added

- **Resume-driven prep plan.** `POST /interview/plan` builds an LLM study plan (sections → topics with a "why", grounded in the active resume + optional target role/seniority/focus), stored in `interview_plans`; `GET /interview/plan` returns the active one. Regenerating deactivates the old plan and keeps it as history.
- **Progress tracking.** `PATCH /interview/plan/:id/progress` upserts per-topic status (todo / in-progress / done) into `interview_topic_progress`; the plan doubles as a persistent checklist with a done/total counter.
- **Question generation.** `POST /interview/questions` generates theory / behavioural / live-coding questions for a topic (cached in `interview_questions`); `POST /interview/questions/:id/model-answer` reveals and caches the reference answer on demand.
- **LLM-reviewed live-coding.** `POST /interview/questions/:id/review` reviews a submitted solution (correctness, complexity, style, suggestions, 0–100 score) and stores each attempt in `interview_answers`. **The code is reviewed, never executed** (ADR-001 / ADR-013).
- **Web UI.** `/app/interview` workspace: plan generation form, sections with per-topic progress selects, a topic drill (generate questions, reveal model answers, live-coding editor + review with a score gauge), plus an `Interview` nav entry.
- **Schema.** Migration `0005`: `interview_plans`, `interview_topic_progress`, `interview_questions`, `interview_answers` (+ enums). The `interview_sessions` table (mock interview) lands with the next increment.

### Fixed

- `serverApiGet` now tolerates an empty response body (a handler returning `null`, e.g. "no active plan") instead of throwing on `JSON.parse`.

## [1.2.3] — 2026-07-21

### Added

- **Mobile burger menu.** The app header now collapses its nav links, user email, and log-out into a hamburger toggle below the `md` breakpoint (`apps/web/components/app-header.tsx`). Tapping the burger opens a panel with the full navigation and account actions; picking a link or logging out closes it. Desktop layout is unchanged. Uses `lucide-react` Menu/X icons; the toggle exposes `aria-expanded` and a descriptive `aria-label`.

## [1.2.2] — 2026-07-21

### Added

- **Keep-alive ping (ADR-006).** A `keep-alive` GitHub Actions workflow pings the public `/health` endpoint every 10 minutes so the free-tier Render container never idles into its ~15-minute spin-down. Eliminates the 30-60s cold-start delay on the first request after a quiet period. Hits only our own health check, so scraping politeness rules do not apply; also runnable on demand via `workflow_dispatch`.

## [1.2.1] — 2026-07-21

### Added

- **Brand logo.** A self-contained radar mark (indigo→violet badge, concentric sweep arcs emanating from the origin toward a detected "blip") that reads the same on light and dark backgrounds. Ships as a reusable `<Logo>` / `<LogoMark>` component (`apps/web/components/ui/logo.tsx`, per-instance gradient ids via `useId`), the app-header brand link, the login/signup header, a static `public/logo.svg`, and the browser favicon (`app/icon.svg`).

## [1.2.0] — 2026-07-21

**Feed-centric, resume-driven relevance (ADR-012).** The resume — not hand-tuned keyword profiles — now drives what's worth applying to, and it all lives in the Feed.

### Added

- **Resume-fit on the vacancy page**: "Насколько подходит мне" scores the active resume against the vacancy through the LLM gateway, cached permanently in `resume_matches` (one call per resume × vacancy). Shown as a colour-banded circular gauge (red <40% < amber <70% < green) with a short RU rationale; the cached score also appears as a `CV NN%` badge on feed cards. `POST /vacancies/:id/resume-match`. Live-verified 2026-07-21.
- **Soft resume-driven seniority filter in the Feed**: a coarse level (`intern | junior | middle | senior | lead`) is detected at ingestion (keyword rules, no LLM) into `vacancies.seniority`; a feed toggle (shown only with an active resume) hides roles two or more grades below the resume. Lenient by design — unknown levels always pass and detection biases to the highest match, so the feed never over-empties. Filtered in SQL across the whole feed. Migration `0004` + idempotent `backfill:seniority` script (`--prod` over Neon HTTPS; 124/275 classified locally).

### Changed

- **Removed the Matches page** and its nav entry; the Feed is the single browse surface. Search profiles and the rules-based `profile_matches` job are kept running in the background (no user-facing view for now).
- `GET /vacancies` is now user-scoped: it left-joins the caller's cached resume score and accepts `resumeFit=true`.

### Fixed

- Default Gemini model is now the evergreen `gemini-flash-latest` alias (pinned `gemini-2.0-flash` has no free-tier quota anymore and `gemini-2.5-flash` is closed to new users). Live E2E 2026-07-21: brief + cover letter + resume scoring verified end-to-end on `gemini-3.1-flash-lite` (Groq geo-blocks this network with 403 — the gateway failover handled it as designed; Groq still works from Render).

## [1.1.0] — 2026-07-21

**Phase 4: the apply assistant (ADR-011) — from a matched vacancy to a sent application without leaving the app.**

### Added

- **LLM gateway** (`llm/`, ADR-005): Groq → OpenRouter → Gemini free tiers via their OpenAI-compatible endpoints, failover on any error, friendly 503 when no key is set; `llmProviders` in `/health`.
- **Resumes**: PDF upload (5 MB cap, magic-byte check), server-side text extraction (pdf-parse v2), single active resume, download, delete (409 if referenced by sent applications); `/app/resume` page + Resume nav item.
- **Vacancy detail page** (`/app/vacancies/[id]`): full stored description in-app; card titles link internally, "Open original ↗" preserved.
- **Apply-contact extraction** at the upsert choke point (email → Telegram handle on contact-ish lines / t.me link → apply URL) + idempotent `backfill:contacts` script (`--prod` runs over Neon HTTPS); contact rendered as mailto/t.me on the detail page. Backfilled: 67/275 locally, 68/276 in prod.
- **On-demand Russian brief**: `POST /vacancies/:id/brief`, cached in `summary_ru` (`?force=true` regenerates); fit section uses the active resume.
- **On-demand cover letter**: `POST /vacancies/:id/cover-letter` — vacancy's language, English capped at the level evident in the resume, 120–180 words, real experience over volume; editable textarea.
- **Email apply via Gmail**: OAuth connect (HMAC-signed state, AES-256-GCM-encrypted refresh token), LLM-drafted subject+body around the edited cover letter, recipient pre-filled from the extracted contact, resume PDF attached, **explicit confirmation before every send**; sends recorded in `outreach_emails` and reflected on the kanban (saved → applied).
- **LLM resume ↔ vacancy matching**: budget-capped (10/run) scoring of rules-matched vacancies, permanent `resume_matches` cache, piggybacks on the ingestion match job + `POST /matches/resume-score`; "CV NN%" badge and Russian fit explanation on Matches.

### Notes

- DB migration `0002` (resumes, resume_matches, outreach_emails, vacancy/user columns) applied locally and to prod Neon.
- Developer TODO to activate the LLM/Gmail paths in prod: set `GROQ_API_KEY` (or OpenRouter/Gemini) and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT` on Render. Everything degrades gracefully until then.
- Tests: 203 api + 55 web.

## [1.0.0] — 2026-07-20

**v1.0 release: the aggregator + application CRM scoped in PRODUCT.md, live and in daily use.**

### Added

- Root README rewritten for the release: real stack table, shipped-scope summary, and screenshots (feed, matches, board, dashboard) in `docs/screenshots/`.

### Notes

- Scope shipped across 0.1.x–0.3.x: auth + sessions, search profiles, three sources (Telegram MTProto primary, RemoteOK, WeWorkRemotely) on a 4-hour cron, heuristic dedup, FTS feed with filters, rules-based matching + Matches page, kanban board with notes and follow-up reminders, Sentry on both apps.
- The daily email digest (Resend) is deferred until after v1.0 by developer decision — matches and reminders are delivered in-app.
- Domain: the free `job-radar-web-phi.vercel.app` subdomain is the v1.0 domain (zero-budget, ADR-001); a custom domain remains optional.
- Sentry DSNs still need to be set in the Render/Vercel dashboards (developer TODO) — monitoring is a no-op until then.

## [0.3.4] — 2026-07-20

**v1.0 release prep: error monitoring on both apps (ADR-010).**

### Added

- **Sentry on `apps/api`** (`@sentry/nestjs`): `instrument.ts` initializes before any other import, `SentryModule.forRoot()` + a global `SentryGlobalFilter` capture HTTP errors, and the ingestion processor reports source-run failures via `Sentry.captureException` (queue jobs run outside the request lifecycle, so the global filter can't see them).
- **Sentry on `apps/web`** (`@sentry/nextjs`): `instrumentation.ts` (Node + Edge), `instrumentation-client.ts` (browser), and `withSentryConfig` in `next.config.ts` (tunnel route, source-map upload when build-time credentials are present).
- `sentryConfigured` presence flag in `GET /health` checks, mirroring `telegramConfigured`.

Everything is DSN-gated: with `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` unset the SDKs are a no-op, so local dev, CI and tests never touch Sentry and the $0 budget holds (ADR-001). Tracing and source-map upload are opt-in.

## [0.3.3] — 2026-07-20

**Phase 3: in-app follow-up reminders ("no answer for N days").**

### Added

- Shared reminder logic (`REMINDER_DEFAULT_DAYS = 7`, waiting stages applied/screening/tech_interview, `isReminderDue`/`daysSinceActivity` helpers) used by both apps.
- `GET /applications/reminders`: applications in a waiting stage with no activity past `remind_after_days` (per-application override) or the default, oldest first.
- Dashboard **"Follow-ups due"** list (real content on `/app` at last) and red **follow-up hints on board cards**; per-card "Remind after N days" input in the notes panel (PATCH on blur).

### Fixed

- Kanban board hydration warning: `DndContext` now uses a stable id instead of dnd-kit's render-order counter, which differed between server and client.

## [0.3.2] — 2026-07-20

**Phase 3: rules-based vacancy ↔ profile matching, materialized and browsable.**

### Added

- **Matching engine** (`apps/api/src/matching`): rules-based scorer — hard filters (work format, employment type, salary minimum within one currency) reject; keyword hits (Unicode word boundaries, RU+EN, title > description) and stack hits produce the score. Unknown vacancy attributes never reject.
- Matches materialized in `profile_matches` via a diff (insert/update score/delete), preserving `matched_at`/`digested_at` on rescore. Recomputed by a `match` queue job after every ingestion + dedup cycle, and inline on profile create/update (inactive profiles hold no matches).
- `GET /matches` (score-ordered, paginated, optional `profileId` filter with ownership check) and `GET /matches/profiles` (per-profile match counts); shared `matchQuerySchema`/`MatchFeed` contracts.
- Web **Matches page** (`/app/matches`): SSR first page, profile filter buttons with counts, score badges, save-to-board, pagination; `VacancyCard` extracted from the feed for reuse.

Also rolls up the post-0.3.1 Telegram go-live work:

- Default Telegram channel list in the source seed (`job_react`, `geekjobs`, `remote_it_jobs` — frontend/fullstack focus, verified live): first real MTProto ingestion run brought 136 vacancies (115 canonical after dedup) into the local feed.
- `telegramConfigured` flag in `GET /health` checks (presence-only, mirrors `ingestionTokenConfigured`) — used to diagnose missing Render secrets during the Telegram prod rollout.
- **Telegram source live in production** (2026-07-20): secrets on Render, channels in prod Neon, 136 vacancies ingested (115 canonical), verified end-to-end through the prod web proxy.

## [0.3.1] — 2026-07-20

**ADR-009 implementation: Telegram ingestion worker + feed source filter.**

### Added

- **Telegram ingestion worker** (primary source, ADR-009): GramJS/MTProto reads public channels from `sources.config.channels`, regex-first parsing (title, company, salary with currency, work format, employment type, location), `external_id = <channel>:<msgId>`, `t.me` deep link as the vacancy URL. Skips politely (no alert) until `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_SESSION` and the channel list are configured; respects FLOOD_WAIT.
- Interactive `pnpm --filter @jobradar/api telegram:session` helper that logs in over MTProto and prints the session string to store as a secret.
- Feed **platform filter**: `sources` query filter on `GET /vacancies`, new `GET /vacancies/sources` endpoint (per-source canonical counts), source checkboxes with counts and labeled source badges in the web feed.

### Fixed

- Feed hydration mismatch: vacancy dates now format with a fixed locale, so SSR and client output match.

## [0.3.0] — 2026-07-20

**Phase 2 (User & UI) complete and deployed.** The author can sign up, browse and search vacancies, manage search profiles, and track applications on a kanban board — live in production.

### Added

- Production deployment: sessions migration applied to Neon; web (Vercel) proxies `/api` to the API (Render) with a first-party session cookie.

### Fixed

- Vercel `API_ORIGIN` had a stray trailing space that broke the `/api` rewrite (baked at build time); corrected and rebuilt. Correct value: `https://jobradar-api-ptvp.onrender.com`.

## [0.2.5] — 2026-07-20

**Phase 2 — application kanban + notes.** All phase-2 features are now built and verified locally; deployment is the only remaining gate.

### Added

- API `applications` module (guarded, user-scoped): `GET/POST /applications`, `PATCH/DELETE /applications/:id`, and `POST /applications/reorder` (batch stage + order in a transaction). `applied_at` stamped when a card reaches applied-or-later; duplicate vacancy → 409.
- Shared contracts: `applicationCreateSchema`, `applicationUpdateSchema`, `applicationReorderSchema`, `APPLICATION_STAGES`, `ApplicationItem`.
- Web `/app/board`: @dnd-kit kanban with 7 stage columns, cross-column drag-and-drop persisted via the reorder endpoint, per-card notes editor (PATCH on blur) and remove.
- Feed "Save" button adds a vacancy to the board; already-tracked vacancies show "On board ✓".

## [0.2.4] — 2026-07-20

**Phase 2 — vacancy feed.** Full-text search, filtering, and pagination over the aggregated vacancies.

### Added

- API `GET /vacancies` (guarded): Postgres full-text search via `websearch_to_tsquery` + `ts_rank` on the generated `search_vector`, filters for work format / employment type / minimum salary, canonical vacancies only, offset pagination with a total count.
- Shared `vacancyQuerySchema` (coerces query-string values, comma-or-array enum filters, bounded `pageSize`), `VacancyListItem`/`VacancyFeed` types.
- Web `/app/feed`: server-rendered first page + client `FeedBrowser` (search box, format/type checkboxes, min-salary, prev/next pagination) with vacancy cards linking out to the source.
- Non-positive salaries (0/0 from some sources) are shown as "no salary" rather than "0–0".

## [0.2.3] — 2026-07-20

**Phase 2 — search profile CRUD.** Users can create, edit, and delete the search profiles that drive matching and digests.

### Added

- API `profiles` module (guarded by the session `AuthGuard`, every query scoped to the current user): `GET/POST /profiles`, `PATCH/DELETE /profiles/:id`. Cross-user access returns 404.
- Shared zod contracts (`profileCreateSchema` with defaults, truly-partial `profileUpdateSchema`, `SearchProfile` type, `WORK_FORMATS`/`EMPLOYMENT_TYPES`) — currency uppercased, `salaryMin ≤ salaryMax` enforced.
- Web `/app/profiles`: server-rendered list + client create/edit/delete manager, `ProfileForm`, `Badge` component. Header gains Dashboard/Profiles navigation.
- `serverApiGet` helper for cookie-forwarding server-side reads.

## [0.2.2] — 2026-07-20

**Phase 2 — web foundation + auth UI.** The web app gains a real design system and a working sign-up / sign-in / sign-out flow wired to the auth backend.

### Added

- Tailwind CSS v4 + a small shadcn/ui-style component set (Button, Input, Label, Card) with light/dark theme tokens.
- `/login` and `/signup` pages sharing an `AuthForm` (client-side zod validation reusing the shared schemas, API error surfacing).
- Auth-protected `/app` area: a server layout resolves the user from the session cookie (redirects to `/login` if absent/expired); `AuthProvider` + `AppHeader` show the signed-in email and a logout button.
- `middleware.ts` gates `/app` on session-cookie presence (real validation stays server-side, no redirect loops).
- Same-origin `/api` proxy via Next rewrites (keeps the session cookie first-party); typed API client (`apiFetch`, `ApiError`) and `lib/auth` helpers.
- `.claude/launch.json` for the local web dev server.

### Changed

- `SESSION_COOKIE_NAME` moved to `@jobradar/shared` as the single source of truth (api + web).
- Root page redirects to `/app`; the phase-0 hello-world home page is gone.

## [0.2.1] — 2026-07-20

**Phase 2 — auth backend.** Email + password authentication with server-side sessions (self-managed in NestJS; no external auth service, per the zero-budget constraint).

### Added

- `sessions` table (opaque token, per-user, expiring) + migration `0001`.
- Auth module: `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- Passwords hashed with scrypt (Node stdlib, memory-hard — no native dependency).
- Session carried in an httpOnly, `SameSite=Lax` cookie (`secure` in production); `AuthGuard` + `@CurrentUser()` for protecting routes.
- Shared zod contracts (`signupSchema`, `loginSchema`, `AuthUser`, `AuthResponse`) reused by web and validated on the API via a `ZodValidationPipe`.
- CORS now sends credentials (cookies) for the eventual direct cross-origin case; the web app will normally proxy `/api` to keep the cookie first-party.

## [0.2.0] — 2026-07-20

**Phase 1 (Data core) complete**: vacancies from two sources (RemoteOK + WeWorkRemotely) land in the production DB automatically every 4 hours, dedup links duplicates, deployed on Render + Neon + Upstash.

### Added

- WeWorkRemotely RSS worker: feed parsing, `Company: Title` splitting, conditional GET (`If-Modified-Since`, 304-aware politeness).

### Changed

- hh source deactivated pending `HH_API_TOKEN` (geo-403 for non-CIS IPs; dev.hh.ru registration requires a Russian phone number). Worker and token support remain in place.

## [0.1.6] — 2026-07-20

### Added

- `/health` redis diagnostics extended: port, TLS flag, and the underlying connection error (WRONGPASS/ETIMEDOUT/... — captured from the ioredis error event, no secrets).
- Optional `HH_API_TOKEN` (dev.hh.ru application token) sent as Bearer + `HH-User-Agent` header — hh.ru geo-blocks anonymous API calls from non-CIS/datacenter IPs (confirmed from both the dev machine and Render).

### Fixed

- `redis://` URLs pointing at `*.upstash.io` get TLS forced (Upstash only accepts TLS; a pasted non-TLS URL is a common dashboard mistake).

## [0.1.5] — 2026-07-20

### Added

- `/health` component diagnostics (`checks`): DB and Redis reachability with timeouts, configured Redis host (no credentials), TLS flag, whether `INGESTION_TOKEN` is set.

### Fixed

- Malformed `REDIS_URL` (stray quotes/whitespace, wrong scheme) no longer crashes bootstrap — it is sanitized, validated, and logged; the app boots with the queue disabled instead. Fixes the failed Render deploy after env vars were added.

## [0.1.4] — 2026-07-19

### Added

- Dedup v1 (ADR-004): pure-TS trigram (Dice) title similarity + same normalized company + 14-day published window; earliest-ingested vacancy stays canonical, chains compressed; runs as a queue job after every ingestion round; thresholds configurable via `DEDUP_SIMILARITY_THRESHOLD` / `DEDUP_WINDOW_DAYS`.
- Ingestion cron (ADR-006): GitHub Actions workflow every 4 hours (+ manual dispatch with `force`), Render cold-start tolerant, no-op with a warning while the host lacks `INGESTION_TOKEN`.
- 11 dedup unit tests.

### Fixed

- `.env` resolution no longer depends on the process working directory.

## [0.1.3] — 2026-07-19

### Added

- BullMQ wiring (`@nestjs/bullmq`, Redis via `REDIS_URL`) with an `ingestion` queue.
- `POST /ingestion/run` hook: bearer-token guard (`INGESTION_TOKEN`, timing-safe compare), enqueues one job per active source; 3 attempts with exponential backoff.
- hh.ru worker: per-profile queries (`keywords OR`-joined, `schedule=remote` for remote-only profiles), pagination with delays, honest User-Agent, 429/Retry-After handling, snippet tag stripping, salary/employment/schedule mapping (RUR→RUB).
- RemoteOK worker: JSON feed, legal-notice filtering, HTML stripping, link-back URLs per their API terms.
- Shared chunked vacancy upsert keyed on `(source_id, external_id)`; company-name normalizer (RU/EN legal suffixes) for the dedup key.
- Politeness: 4-hour minimum interval per source (skip unless `force`), `last_run_status` bookkeeping (`ok`/`empty`/`error`).
- 15 new unit tests (normalizers, company names, token guard).

## [0.1.2] — 2026-07-19

### Added

- Idempotent seed (`pnpm --filter @jobradar/api db:seed`): source registry (`hh`, `remoteok` active; `weworkremotely` registered but inactive) and, outside production, a dev user with a default remote-React search profile.
- Seed data unit tests.

## [0.1.1] — 2026-07-19

### Added

- ADR-008: Drizzle as the ORM (`drizzle-orm` + `drizzle-kit`, `pg` driver).
- Full DB schema in `apps/api/src/db/schema.ts` per DATA_MODEL.md: 5 enums, 6 tables, generated `tsvector` column with GIN index, composite PK on `profile_matches`, unique `(source_id, external_id)` and `(user_id, vacancy_id)`.
- Initial migration `apps/api/drizzle/0000_init-schema.sql`; `db:generate` / `db:migrate` scripts.
- Nest `DbModule` (global, lazy `pg` Pool via `ConfigService`) and `ConfigModule` wired into the app.
- Schema unit tests (tables, unique indexes, GIN/generated column, composite PK, enum values).

## [0.1.0] — 2026-07-19

**Phase 0 (Foundation) complete**: both apps deployed over HTTPS, CI green.

### Added

- Production hello-world deployments: web on Vercel (<https://job-radar-web-phi.vercel.app>), api on Render (<https://jobradar-api-ptvp.onrender.com/health>).
- `apps/web/vercel.json`: build `packages/shared` before `next build` (fixes Vercel monorepo build).

## [0.0.5] — 2026-07-19

### Added

- `apps/api/Dockerfile` (multi-stage pnpm monorepo build, production-only bundle via `pnpm deploy`) and root `.dockerignore`; image built and smoke-tested locally.
- `render.yaml` blueprint: API as a free-tier Docker web service on Render with `/health` health check.
- ADR-007: API hosting on Render free tier (Railway and Fly.io no longer offer free tiers).

### Changed

- ARCHITECTURE, README, ROADMAP updated: API host is Render; ORM decision renumbered to ADR-008.

## [0.0.4] — 2026-07-19

### Added

- GitHub Actions CI (`.github/workflows/ci.yml`): build, lint, typecheck and tests on every PR and on pushes to `main`; pnpm cache, frozen lockfile, per-ref concurrency cancellation.

## [0.0.3] — 2026-07-19

### Added

- `docker-compose.yml` for local dev: Postgres 17 (alpine) + Redis 8 (alpine) with healthchecks and persistent volumes.
- `.env.example` documenting `DATABASE_URL`, `REDIS_URL`, API port/CORS origin and `NEXT_PUBLIC_API_URL` (values match compose defaults).
- README: infrastructure quick-start (docker compose up/down) in the Development section.

## [0.0.2] — 2026-07-19

### Added

- Monorepo scaffold on pnpm workspaces: `apps/web`, `apps/api`, `packages/shared`.
- `apps/web`: Next.js 16 (App Router, TypeScript) hello-world page.
- `apps/api`: NestJS 11 hello-world with `GET /health` endpoint (returns service name, version, timestamp) and a Jest unit test.
- `packages/shared`: shared TypeScript package (`APP_NAME` constant, `HealthResponse` type), consumed by both apps.
- Shared strict `tsconfig.base.json`; per-package `build` / `dev` / `lint` / `typecheck` / `test` scripts wired to root scripts.
- ESLint 9 flat configs: `eslint-config-next` (web), `typescript-eslint` (api).
- `apps/web`: Vitest + React Testing Library setup with home-page tests.
- CLAUDE.md conventions: commit & push after every coherent chunk of work; tests are mandatory for both apps.

## [0.0.1] — 2026-07-19

### Added

- Project documentation set: README, PRODUCT, ARCHITECTURE, DATA_MODEL (draft), DATA_SOURCES, ROADMAP, RISKS.
- ADRs 001–006 (zero budget, separate backend, no LinkedIn scraping, heuristic dedup, LLM free-tier failover, GitHub Actions cron).
- CLAUDE.md — AI-assistant context entry point with worklog and versioning conventions.
- docs/WORKLOG.md — chronological work log.
- Original planning document preserved as docs/original-plan.ru.md.
