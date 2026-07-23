# Worklog

> Chronological log of work done. Newest entries on top. Every session that changes the repo must add an entry (see CLAUDE.md).

## 2026-07-23 — Day planner increment 2: focus timer, close-out, estimation factor (ADR-015, v1.8.0)

- **Focus timer.** `POST /planner/blocks/:id/start|pause|complete` writes `focus_sessions` and banks whole minutes onto `plan_blocks.actual_minutes`. The invariant is one running session per user: starting another block ends the current session as `paused` and returns that block to `pending`. `DayPlanDetail` gained `activeSession { blockId, startedAt, bankedMinutes }` so the client can tick a live counter without polling.
- **Outcomes and close-out.** Completing a block takes `done` / `partial` / `skipped`; anything short of done requires a reason (400 otherwise) and a finished block cannot be re-resolved (409). `POST /planner/plans/:id/close` marks the leftovers `skipped` + `unreported`, stores the review (done/total, planned vs actual, minutes per category, debt created) on the plan, and locks the day.
- **Estimation factor, for real.** Median `actual / estimate` over ≤20 timed blocks, global and per category, recomputed at close; needs ≥5 samples (otherwise ×1.00) and is clamped to [0.5, 4]. Lives in `packages/shared` as pure functions (`estimationFactor`, `summarizeDay`, `debtBlocks`, `elapsedMinutes`) so the UI can preview the review before committing to it.
- **Web.** Per-block Start/Pause + live `elapsed / estimate`, a Finish panel (outcome + reason + note), a Day-review card with a live preview and a close-with-note flow, status/`took N min` badges, and a locked closed state. New `day.*` / `blockStatus.*` keys in EN and RU.
- **Tests**: 305 API (13 new — estimation/summary/elapsed helpers, complete/close schemas, controller delegation) and 96 web (7 new); lint + typecheck clean.
- **Live-verified against the running API**: auto-pause on switching blocks (`focus_sessions` shows one `paused` + one open row), 400 on a reasonless `partial`, 409 on re-completing and on re-closing, close → `Anthropic course` recorded `skipped/unreported`, review `{completed 1, total 2, planned 60, debt 1}` (the dropped block correctly excluded), and the factor recomputed to **×2.00** (per-category `learning: 2`) from five seeded 30→60 min blocks. The closed day renders locked in the UI.
- **Next step:** increment 3 — LLM plan composition over the existing candidate list (with the deterministic fallback), then increment 4 — `planner:tick` + Telegram bot nudges, which also brings the automatic end-of-day close.

## 2026-07-23 — Day planner increment 1: schema, candidates, manual plan (ADR-015, v1.7.0)

- **Schema (migration `0008`)**: `planner_settings`, `day_plans`, `plan_blocks`, `focus_sessions`, `planner_nudges` — the full ADR-015 shape at once, so increments 2–4 add behaviour, not migrations. New enums prefixed `plan_*` / `planner_*` (`plan_block_source`, not `source_kind`, which `sources.kind` already owns).
- **API `planner/`**: `GET /planner/today|candidates|settings`, `PATCH /planner/settings`, `POST /planner/plans` (idempotent per local day) + `/accept` + `/reorder`, `PATCH /planner/plans/:id` (intent), `POST|PATCH|DELETE /planner/blocks`. Candidates come from plain SQL over existing state — debt, due follow-ups, open prep topics, profile-matched vacancies not yet on the board — and are titled in the account language (`planner/labels.ts`, ADR-014), because a planned block persists its title as text.
- **Guardrails**: dropping a block writes `status=dropped` + a reason instead of deleting; accepting a day requires at least one live block; reorder must list exactly the plan's blocks; estimates are stored raw *and* corrected by `estimation_factor`, and capacity is checked against the corrected value. Per-user IANA timezone decides what "today" is (`localDayKey`, `Intl` only — no date library).
- **Web `/app/day`**: queue with reorder / inline estimates / drop-with-reason, candidate list with one-click add, manual block form, day intent, accept banner, capacity + factor + debt badges, and a "use device timezone" prompt. Nav gained **Day**; dictionaries gained the `day.*` / `planCategory.*` / `planSource.*` / `skipReason.*` blocks in EN and RU.
- **Tests**: 292 API (23 new: schemas, helpers, labels, controller delegation, candidate-key dedup) and 89 web (8 new component tests) — all green, lint + typecheck clean.
- **Browser-verified locally** on seeded data: all four candidate kinds listed; adding a debt candidate created today's plan and carried `carry_count` 2×; added items disappear from suggestions; reorder, drop-with-reason (`Avoided it`, capacity 60→45 min), intent save, accept ("День принят") and the EN/RU switch all behaved as specified.
- **Next step:** increment 2 — focus timer (`focus_sessions`), evening close-out that creates debt, and the estimation factor computed from real actuals.

## 2026-07-23 — Day planner: design docs (ADR-015, no code yet)

- **Problem framed with the developer.** Three parallel tracks (applying, interview prep, Anthropic courses), the bottleneck is execution and estimation, not finding work. A plain calendar is explicitly rejected — it is ignorable and one shifted slot invalidates the rest of the day.
- **Decisions taken** (chosen from options, see [ADR-015](decisions/015-day-planner-accountability.md)): ordered queue of timeboxes instead of a time grid; LLM composes the plan from real DB state (due follow-ups, `todo` prep topics, matching vacancies, manual backlog, debt) with a deterministic fallback; morning accept + evening close ritual; rolling debt with `carry_count` and rotting blocks instead of streaks; focus timer feeding a personal estimation factor; Telegram **bot** nudges with bounded escalation. Rejected for now: a hard route-level gate on the feed, streak counter, forced mid-block check-ins.
- **Infrastructure note.** `planner:tick` runs as a 1-minute BullMQ repeatable job **inside the API**, deliberately not via GitHub Actions (ADR-006): the repo is private, so minute-granularity workflow cron would exceed the free minute allowance, and the existing 10-min keep-alive already keeps the Render instance warm.
- **Docs updated:** ADR-015 (Proposed) + decisions index, PRODUCT.md (core concepts + out-of-scope), ARCHITECTURE.md (planner module, "two clocks", "two Telegram integrations"), DATA_MODEL.md (`planner_settings`, `day_plans`, `plan_blocks`, `focus_sessions`, `planner_nudges` — migration `0008` planned), ROADMAP.md (new phase-4 section).
- **Next step:** accept ADR-015 and implement in increments — schema + candidates + manual plan first, then timer/close-out/debt, then LLM generation, then the Telegram bot.

## 2026-07-22 — Two-language interface, EN/RU (ADR-014, v1.6.0)

- **Account language.** New `users.language` (`'en' | 'ru'`, default `'ru'`), on `AuthUser`, updatable via `PATCH /auth/me`; a `jr_lang` cookie mirrors it for server components and pre-auth pages. Migration `0007` (also adds `vacancies.summary_en`(+ts) and `resume_matches.explanation_en`).
- **Web i18n from scratch (no library).** `lib/i18n` isomorphic dictionaries (flat keys, `ru` typed against `en`), `I18nProvider`/`useI18n()`, `getServerT()`, header EN/RU switcher (+ on auth pages). Translated the whole interface: nav, dashboard, feed, board, profiles, profile-form, resume, interview workspace, mock interview, apply-email, and both vacancy-detail assistant sections. Format/type/stage/status labels moved into the dictionaries.
- **Bilingual generation + caching.** EN variants of `buildBriefPrompt`/`buildResumeMatchPrompt`; generation language = `user.language`, passed from controllers. Brief cached per language (`summary_en` beside `summary_ru`); fit score generated once, rationale cached per language (`explanation_en`). Renamed `BriefResponse/VacancyDetail.summaryRu` → `summary`.
- **Tests + verification.** New backend specs (EN prompts, `updateMe`) and web specs (dictionary parity, provider switch); 269 API + 81 web tests green, lint + typecheck clean. Browser-verified locally end-to-end: UI switches instantly pre-auth and authenticated, PATCH persists to the account (DB shows `en`), both priority sections flip with the toggle.
- **Next step:** apply migration to prod (`db:migrate:prod`) and confirm on the deployed app; decide whether the default should stay `ru` or flip to `en`.

## 2026-07-21 — Three more job platforms: Remotive, Jobicy, Working Nomads (v1.5.0)

- **Added three free no-auth JSON sources.** Remotive (`?category=software-dev`), Jobicy (`?industry=dev`) and Working Nomads (`exposed_jobs`), each with normalizer + service + unit tests, wired into the ingestion processor/module and seeded active. Web feed source filter gained labels for all three.
- **Chosen against ADR-001.** Probed each candidate live before committing: all four shortlisted (incl. Arbeitnow, Himalayas) returned HTTP 200 unauthenticated. Picked the developer's two (Remotive, Jobicy) plus Working Nomads for the requested freelance lean. True freelance marketplaces (Upwork/Freelancer/Fiverr/Toptal) rejected — no free open API, OAuth-gated, scraping-forbidden.
- **Noise control.** Remotive's `category` param leaks non-tech items, so the worker filters to a tech-category allowlist client-side; Working Nomads is filtered to `Development`; Jobicy's `industry=dev` is clean at the source. Live-verified parse: Remotive 41→20, Jobicy 50→50, Working Nomads 38→23, salaries/employment mapped correctly.
- **Tests + build green.** New normalizer specs, updated `seed-data.spec` (active list) and `ingestion.processor.spec` (constructor args); api lint/typecheck/build and web feed-browser tests pass.
- **Next step:** apply to prod with `db:migrate:prod` (neon-apply upserts the new sources into Neon), then watch a cron cycle to confirm the three feeds yield vacancies.

## 2026-07-21 — More Telegram job channels (v1.4.1)

- **Broadened Telegram coverage 3 → 6 channels.** Added `rabotafrontend` (frontend), `golang_jobs` (Go/backend) and `qa_jobs` (QA) alongside `job_react` / `geekjobs` / `remote_it_jobs`.
- **Chosen by probing, not by lists.** Wrote a throwaway MTProto probe (existing session) over ~16 candidates measuring reachability, posts/day and vacancy-vs-noise ratio, then sampled post titles. Rejected: dead archives (`remotedevjobs`, `jobjs` — newest posts from 2022), resume feeds (`python_jobs`, `nodejs_jobs`), spam/discussion chats (`reactjs_jobs`, `javascript_jobs`, `devops_jobs`), generic non-dev boards (`distantsiya`, `remocate`, `devjobs` = marketing/HR/gamedev) and invalid usernames. Frequency alone was misleading — content sampling was decisive.
- **Applied to prod** via `db:migrate:prod` (neon-apply upserts `sources.config`); verified all 6 channels present in prod. Local `seed-data.ts` updated; new `seed-data.spec` case guards clean, unique, `@`-free usernames. api tests green.
- **Next step:** watch a cron run to confirm the new channels yield vacancies without noise spikes.

## 2026-07-21 — Mock interview (v1.4.0, ADR-013 increment 2)

- **Shipped the mock interview**, completing the interview-prep module (ADR-013). Text-chat rehearsal with an LLM interviewer at `/app/interview/mock`.
- **Backend:** `interview_sessions` endpoints on the existing controller — `POST /interview/sessions` (interviewer opens, grounded in the active resume + optional target role/seniority, derivable from a plan), `POST .../:id/reply` (records the candidate turn, returns the interviewer's reactive follow-up; full `transcript` persisted), `POST .../:id/finish` (LLM feedback report: summary/strengths/gaps/recommendation + 0–100 score; status → completed), `GET .../active` (resume an in-progress session). Turn-based via serialised transcript in the prompt (LlmService stays system+user). New prompts in `prompts.ts`: `buildInterviewerPrompt`, `cleanInterviewerReply`, `buildFeedbackPrompt`, `parseFeedbackReply`.
- **Schema:** migration `0006` — `interview_sessions` (jsonb `transcript`/`feedback`, `plan_id` set-null) + `interview_session_status` enum.
- **Web:** `interview-mock.tsx` (start form, interviewer/candidate chat bubbles, answer box, finish → feedback card with `ScoreGauge`), `/app/interview/mock` page, `Mock interview →` link from the prep workspace, session client fns in `lib/interview.ts`.
- **Tests:** api 245 (+7: interviewer/feedback prompt parsers, session controller delegation), web 74 (+3: interview-mock start/reply/finish). Lint/typecheck clean both apps.
- **Live-verified locally (Groq/Gemini):** as the demo user with a resume — interviewer opened with a resume-grounded question ("your Webpack→Vite migration"), reacted to the answer and asked a relevant follow-up (design systems / micro-frontends), finish produced an 85% report grounded in what was said. No console errors.
- **Version 1.4.0:** CHANGELOG + all four `package.json` + CLAUDE.md line. Docs synced (ROADMAP mock-interview ticked + module marked complete, DATA_MODEL status).
- **Prod TODO (developer):** apply migrations `0005` + `0006` on Neon (`db:migrate:prod`).
- **Next step:** interview-prep module is feature-complete; remaining phase-4 items (Telegram bot, browser extension, more sources, calendar sync) by appetite.

## 2026-07-21 — Interview-prep module, first increment (v1.3.0, ADR-013)

- **Shipped the interview-prep module (ADR-013), increment 1:** standalone, resume-driven, at `/app/interview` — reuses the LLM gateway (ADR-005) + resumes, no new service/infra.
- **Backend `interview/`:** `InterviewService` + controller (guarded). `POST/GET /interview/plan` (LLM plan from the active resume, sections → topics, stored in `interview_plans`, active-plan history), `PATCH /interview/plan/:id/progress` (per-topic upsert), `POST/GET /interview/questions` (theory/behavioural/coding, cached), `POST .../:id/model-answer` (reveal + cache), `POST .../:id/review` (LLM review of a submitted solution — **not executed** — stored in `interview_answers`). Pure prompt builders + parsers in `prompts.ts`.
- **Schema:** migration `0005` — `interview_plans` (`resume_id` nullable/set-null), `interview_topic_progress`, `interview_questions`, `interview_answers` + 2 enums. `interview_sessions` (mock interview) deferred to increment 2.
- **Web:** `interview-workspace.tsx` (plan form, sections + progress selects, topic drill with question generation, model-answer reveal, live-coding editor + review via `ScoreGauge`), `lib/interview.ts`, `/app/interview` page, `Interview` nav link.
- **Bug fixed (found in browser verify):** `serverApiGet` threw on an empty body — `GET /interview/plan` returns `null` (empty body) when there's no plan; now returns null gracefully.
- **Tests:** api 238 (20 new: prompts parsers + controller delegation), web 71 (interview-workspace 4 cases + header nav). Lint/typecheck clean both apps.
- **Live-verified locally (Groq/Gemini):** signed up a demo user with a real resume → generated a 12-topic senior-frontend plan grounded in the resume (caught its self-identified algorithms gap); marked a topic Done (1/12 persisted); generated a live-coding "virtual list" task; reviewed a React solution → 0.85 with an accurate overscan/`key` critique. No console errors.
- **Version 1.3.0:** CHANGELOG + all four `package.json` (synced from the previous 1.2.2/1.2.3 split) + CLAUDE.md line. Docs synced (ROADMAP ticks, DATA_MODEL status).
- **Prod TODO (developer):** apply migration `0005` on Neon (`db:migrate:prod`).
- **Next step:** increment 2 — mock interview (`interview_sessions` + enum, text-chat endpoints, chat UI).

## 2026-07-21 — Interview-prep module planned (ADR-013, docs only)

- **Decision (ADR-013):** add a large **interview-prep module** as a phase-4 extension *inside* JobRadar rather than a separate app — the developer explicitly did not want to stand up new infrastructure. Reuses the existing monorepo, NestJS/Next apps, Neon Postgres, the ADR-005 LLM gateway, and resumes-in-Postgres (ADR-011). No new service, no new external dependency.
- **Shape (clarified with the developer):** **standalone, resume-driven** (not tied to a vacancy/kanban card); live-coding is **LLM-reviewed, not executed** (no sandbox — ADR-001); mock interview is **text chat**, not voice. Five sub-features: resume-driven prep plan, per-topic progress tracking, generated theory/behavioural/coding questions with on-demand model answers, LLM-reviewed live-coding, text mock interview with a feedback report. All generation on-demand + cached (token discipline, ADR-005).
- **Docs synced:** new ADR-013 + ADR index; PRODUCT.md (4 new core concepts + out-of-scope entry); ARCHITECTURE.md (`interview/` module, LLM stack row, and back-filled the missing ADR-012 row in the decisions table); DATA_MODEL.md (entity diagram + 5 new tables: `interview_plans`, `interview_topic_progress`, `interview_questions`, `interview_answers`, `interview_sessions`); ROADMAP.md (new phase-4 "Interview prep" checklist); CHANGELOG Unreleased.
- **No version bump / no code:** planning + documentation only; nothing shipped, so the app version stays 1.2.3.
- **Next step:** implement the schema + migration first (DATA_MODEL tables), then build sub-features by appetite starting with prep-plan generation.

## 2026-07-21 — Mobile burger menu in the app header (v1.2.3)

- **Problem:** the app header laid all nav links + email + log-out in one horizontal row, which overflowed / cramped on narrow (phone) viewports.
- **Fix:** `apps/web/components/app-header.tsx` now hides the inline nav and account block below the `md` breakpoint and shows a hamburger toggle (lucide `Menu`/`X`). Toggling reveals a stacked panel with the full nav + email + log-out; selecting a link or logging out collapses it. Local `useState`; desktop markup untouched. Accessible toggle (`aria-expanded`, `aria-label`).
- **Tests:** new `apps/web/components/app-header.test.tsx` (5 cases) — renders all links, starts collapsed, burger opens/closes, link tap closes, mobile log-out fires. Typecheck + lint clean.
- **Note:** header lives behind auth (`/app`) and needs the API, so browser preview was impractical; behavior is covered by the component tests.
- **Next step:** unchanged — remaining phase-4 items by appetite.

## 2026-07-21 — Keep-alive ping for the free-tier API (v1.2.2)

- **Problem:** the Render free-tier container spins down after ~15 min of inactivity, so the first request after a quiet period waits 30-60s for a cold start — the app feels slow/unresponsive.
- **Fix:** new `.github/workflows/keep-alive.yml` — GitHub Actions pings the public `/health` GET every 10 min (safely under the 15-min sleep window), keeping the instance warm. Extends the existing external-cron approach (ADR-006). `concurrency` cancels overlapping runs; `-m 150 --retry 2` tolerates a cold start; also `workflow_dispatch` for manual pings. No secret needed (health is public); no app code, so no tests.
- **Note:** a warm 24/7 instance uses ~730 of Render free's 750 monthly instance-hours — fine for a single free web service. Ping touches only our own endpoint, so it does not affect scraping politeness (ADR / DATA_SOURCES).
- **Next step:** unchanged — remaining phase-4 items by appetite.

## 2026-07-21 — Brand logo / radar mark (v1.2.1)

- **Logo designed & added.** A radar-sweep mark: an indigo→violet rounded badge with three concentric arcs emanating from a bottom-left origin toward a detected "blip" (the found vacancy), plus a 45° sweep line. Self-contained gradients → identical on light/dark. Fits the product name (JobRadar) and the existing primary hue (oklch 264).
- **Delivery:** reusable `Logo` / `LogoMark` component (`apps/web/components/ui/logo.tsx`, per-instance gradient ids via `useId`, optional wordmark), wired into the app-header brand link (26px) and the login/signup screen (36px, above the card). Also `public/logo.svg` (static asset) and `app/icon.svg` (Next auto-detected favicon).
- **Verified:** login page renders mark + wordmark in-browser; favicon served `200 image/svg+xml` and linked in `<head>`; no console errors. Tests 62 web passing (added `logo.test.tsx`: size, per-instance gradient uniqueness, wordmark toggle); lint + typecheck clean.
- **Version 1.2.1**: CHANGELOG + all four `package.json` + CLAUDE.md line.
- **Next step:** unchanged — remaining phase-4 items by appetite.

## 2026-07-21 — Feed-centric resume relevance; Matches removed (v1.2.0, ADR-012)

- **ADR-012 accepted:** the resume drives relevance, and it all lives in the Feed. The confusing, usually-empty Matches page (keyword-profile matching) is gone; Profiles + the `profile_matches` job stay running in the background (developer chose "keep as-is" over deleting).
- **A — on-demand resume-fit on the vacancy page:** "Насколько подходит мне" → `POST /vacancies/:id/resume-match` scores the active resume via the LLM gateway, cached in `resume_matches` (repeat = free). Rendered as a colour-banded circular `ScoreGauge` (red/amber/green) + RU rationale; cached `CV %` badge also shows on feed cards.
- **B — soft seniority filter:** `detectSeniority` (shared, rules-only, EN+RU keywords, highest-match-wins) runs at the ingestion choke point into new `vacancies.seniority`. Feed toggle (only with an active resume) hides roles ≥2 grades below the resume; unknown level always passes → never over-empties. Filtered in SQL across the whole feed. Migration `0004` + `backfill:seniority` (124/275 local).
- **Live-verified locally (Gemini/Groq configured):** feed `resumeFit=true` 251 → 239 (senior resume hides 7 intern + 5 junior); React-Native vacancy vs frontend-no-RN resume → **40%** with an accurate "critical React Native gap" explanation; second call `cached=true`; gauge renders in-browser; no Matches nav; no console errors.
- **Tests/build green:** 218 api + 58 web (Matches tests removed, gauge/toggle/match-section tests added), lint/typecheck clean, web prod build clean (no `/app/matches` route).
- **Version 1.2.0**: CHANGELOG + all four `package.json` + CLAUDE.md line. Docs synced (ADR-012, DATA_MODEL `seniority`, ADR index, ROADMAP).
- **Prod TODO (developer):** apply migration `0004` on Neon (`db:migrate:prod`) + run `backfill:seniority --prod`; the Google 403 on Gmail connect is the OAuth "Testing" mode — add `batashof@gmail.com` as a Test user in the Cloud Console consent screen.
- **Next step:** live Gmail send once the test-user is added; remaining phase-4 items by appetite.

## 2026-07-21 — Live LLM E2E green (Gemini); default Gemini model fixed

- **Keys provisioned by the developer** (Groq + Gemini locally; Sentry skipped for now). Groq turned out to geo-block this network (403 "Access denied") — the ADR-005 failover switched to Gemini exactly as designed; Groq remains first in line for Render (US egress).
- **Gemini model churn:** `gemini-2.0-flash` now returns free-tier 429 (zero quota) and `gemini-2.5-*` is "no longer available to new users" — code default switched to the evergreen `gemini-flash-latest` alias; local `.env` pins `GEMINI_MODEL=gemini-3.1-flash-lite` (verified working; the alias saw transient 503s under load).
- **Live E2E, all green:** RU brief (fresh → cached), Russian cover letter grounded in the test resume (real facts, vacancy's language, signed with the candidate name), resume scoring `{scored: 10, remaining: 21}` with well-differentiated scores (95% React match / 40% React-Native gap / 20% junior role) and RU explanations rendered on the Matches page.
- **Remaining to verify live:** Gmail connect + send (needs the developer's own Google login → 2-minute manual browser step), and the same env vars on Render.

## 2026-07-21 — Phase 4: apply assistant shipped (v1.1.0, ADR-011)

- **The whole ADR-011 block landed in one day**, committed feature-by-feature (schema → LLM gateway → resumes → detail page → contacts → brief/letter → Gmail → resume matching):
  - `llm/` gateway (ADR-005): Groq → OpenRouter → Gemini, failover, 503 when keyless; `llmProviders` in /health.
  - `resumes/`: PDF upload (bytea + pdf-parse text extraction), active-resume management, `/app/resume` UI.
  - Vacancy detail page `/app/vacancies/[id]` (full description in-app; card titles now link internally).
  - Apply-contact extractor in the upsert choke point + `backfill:contacts` (`--prod` over Neon HTTPS): 67/275 local, 68/276 prod.
  - `outreach/`: cached RU brief (`summary_ru`), resume-calibrated cover letter, Gmail OAuth (signed state, AES-GCM refresh token), draft → edit → **explicit confirm** → send with the resume PDF attached; `outreach_emails` recorded, kanban moves saved → applied.
  - Resume ↔ vacancy LLM matching: 10/run cap on the ingestion match job + `POST /matches/resume-score`; CV % badge + RU explanation on Matches.
- **Migration 0002 applied to local and prod Neon**; both prod builds verified locally; 203 api + 55 web tests, lint/typecheck green.
- **Developer TODO for prod:** set `GROQ_API_KEY` (or another free-tier LLM key) and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT` (`https://jobradar-api-ptvp.onrender.com/gmail/oauth/callback`) on Render, plus the still-pending Sentry DSNs. Everything degrades gracefully until then.
- **Next step:** live-run the LLM/Gmail paths once keys exist; then the remaining phase 4 items by appetite.

## 2026-07-20 — v1.0.0 released

- **README rewritten for the release:** shipped-scope summary, real stack table (Drizzle, Telegram MTProto, no more "planned"), live links, and a Screenshots section.
- **Screenshots** (`docs/screenshots/`): feed, matches, board, dashboard — captured from the local app (same code/data shape as prod) via headless Chrome with a dedicated `screens@jobradar.local` account seeded through the public API (profile → matches materialized, 6 applications across all stages, one backdated for the follow-up hint).
- **Version 1.0.0**: CHANGELOG entry, all four `package.json` files bumped, CLAUDE.md current-version line fixed (was stale at 0.0.1).
- **ROADMAP:** Release v1.0 ticked (domain = free vercel.app subdomain per ADR-001), phase 3 exit criterion met, current-phase marker moved to **4 — Extensions (apply assistant first)**.
- **Developer TODO:** set Sentry DSNs in Render/Vercel dashboards (monitoring is a no-op until then).
- **Next step:** phase 4 apply assistant (ADR-011) — DB schema, LLM gateway, resumes module.

## 2026-07-20 — Docs: apply assistant designed for phase 4 (ADR-011)

- **ADR-011 accepted:** resume-driven apply assistant — PDF resume upload (bytea in Postgres + extracted text), in-app vacancy detail page, LLM resume ↔ vacancy matching (only rules-matched vacancies, cached permanently), on-demand Russian vacancy brief, on-demand cover letter (vacancy's language, English calibrated to the resume, short, real experience over volume), apply-contact extraction, email apply via Gmail API (OAuth `gmail.send`, user's own account, explicit confirmation before every send).
- **PRODUCT.md:** four new core concepts (Resume, Vacancy brief, Cover letter, Apply contact); the "in-app apply" rejection revised — *fully automated* applying stays rejected, user-initiated email applies are phase 4 scope.
- **ROADMAP.md:** phase 4 restructured into "Apply assistant (ADR-011)" checklist + "Other extensions".
- **DATA_MODEL.md:** planned phase 4 section — `resumes`, `resume_matches`, `outreach_emails` tables; `vacancies.apply_contact` / `summary_ru`, `users.gmail_refresh_token`.
- **ARCHITECTURE.md:** ADR index caught up (9–11); planned `llm/`, `resumes/`, `outreach/` modules; LLM + Gmail rows in the stack table.
- Docs only — no code. Nothing starts before v1.0 ships (scope discipline).
- **Next step:** unchanged — v1.0 release (domain, README with screenshots).

## 2026-07-20 — v1.0 prep: Sentry error monitoring on both apps (v0.3.4)

- **ADR-010:** Sentry on both services, free Developer plan (fits ADR-001). All DSN-gated — unset → SDK no-op, so local/CI/tests never touch Sentry; tracing and source-map upload are opt-in.
- **API** (`@sentry/nestjs`): `instrument.ts` imported first in `main.ts`; `SentryModule.forRoot()` + global `SentryGlobalFilter`. The ingestion processor's catch now calls `Sentry.captureException(err, { tags: { source, job } })` — BullMQ jobs run outside the HTTP lifecycle so the global filter can't see them (the silent-cron-failure case is the one that matters). `sentryConfigured` presence flag added to `GET /health`.
- **Web** (`@sentry/nextjs`): `instrumentation.ts` (Node/Edge), `instrumentation-client.ts` (browser + `onRouterTransitionStart`), `withSentryConfig` in `next.config.ts` (tunnel `/monitoring`, `disableLogger`, source-map upload gated on `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN`).
- `@sentry/cli` added to pnpm `allowBuilds` (downloads its binary for source-map upload; no-op without a token). `.env.example` documents the new vars.
- **Verified:** api build emits `dist/instrument.js` imported first; web build clean, Sentry instrumentation compiled with no DSN (no-op). 150 api + 35 web tests green (added `ingestion.processor.spec.ts` for the capture path), typecheck/lint clean.
- **Developer TODO for prod:** create two Sentry projects, set `SENTRY_DSN` on Render and `NEXT_PUBLIC_SENTRY_DSN` on Vercel (optionally the source-map upload trio on Vercel). Until then monitoring is simply off.
- **Next step:** remaining v1.0 items — domain + README with screenshots.

## 2026-07-20 — Phase 3: in-app follow-up reminders (v0.3.3)

- **Reminders ship in-app** (email digest deferred): shared logic in `@jobradar/shared` — waiting stages (applied/screening/tech_interview), threshold = `remind_after_days` override or 7-day default, whole days since `last_activity_at` (clamped ≥ 0).
- **API:** `GET /applications/reminders` — SQL filter (`last_activity_at <= now() - make_interval(days => coalesce(remind_after_days, 7))`), oldest first. **Web:** dashboard replaced its placeholder with a "Follow-ups due" list (days waited + threshold badge, link to the board); board cards show a red "No answer for N days — follow up?" hint and gain a "Remind after N days" input in the notes panel (PATCH on blur, 1–365 clamp); `destructive` Badge variant added.
- **Fixed a pre-existing kanban hydration warning:** dnd-kit's counter-based `DndContext` id differs between SSR and client → pinned `id="application-board"`.
- **E2E (local):** curl — created `applied` application, 0 due → SQL-backdated 9 days → 1 due → override 30 → 0 due. Browser — dashboard lists 3 overdue cards with red badges; board shows hints; setting "Remind after" to 30 via UI persisted (DB checked) and the card's hint disappeared instantly while the other two stayed. 148 api + 35 web tests, lint/build clean.
- **Next step:** v1.0 release prep — domain, Sentry on both apps, README with screenshots.

## 2026-07-20 — Phase 3 started: vacancy ↔ profile matching (v0.3.2)

- **Scope decision (developer):** phase 3 proceeds **without the Resend email digest** — deferred until after v1.0 (ROADMAP annotated). Matches are delivered in-app; reminders will be in-app too.
- **Matching engine** (`apps/api/src/matching`): pure `scoreMatch` — hard filters reject on known conflicts only (work format, employment type, salary minimum compared within one currency; unknown attributes pass), then keyword/stack scoring with Unicode-aware word boundaries (`\b` fails on Cyrillic; "go" doesn't hit "google", "c++" works). Title hit = 1, description-only = 0.7; keywords are the required primary signal (0.65/0.35 blend with stack), filter-only profiles get a flat 0.25.
- **Materialization:** `MatchingService` diffs desired vs existing `profile_matches` per profile (insert / update score / delete), preserving `matched_at`/`digested_at` on rescore; inactive profiles hold zero matches. Runs as a `match` queue job enqueued after dedup on every ingestion run, and inline on profile create/update.
- **API:** `GET /matches` (guarded, score-ordered, paginated, `profileId` filter with ownership 404) + `GET /matches/profiles` (per-profile counts). **Web:** `/app/matches` — SSR first page, profile filter buttons, score badges, save-to-board; `VacancyCard` extracted from the feed for reuse; Matches added to the header nav.
- **E2E (local, real data):** profile create → 29 matches materialized instantly; deactivate → 0, reactivate with narrower keywords → 26; deleted 3 rows in SQL → `POST /ingestion/run` (`match` job) restored them. Browser: Matches page renders mixed RU/EN matches sorted by score (82% → 27%), profile filter click refetches, Save → "On board ✓". 141 api + 30 web tests, lint/typecheck clean.
- **Next step:** in-app follow-up reminders ("no answer for N days"), then v1.0 release prep (domain, Sentry, README).

## 2026-07-20 — Telegram source live in production

- Prod Neon updated via `db:migrate:prod` (seed upsert now carries the `telegram` source + channels). Developer set `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_SESSION` on Render — first attempt didn't apply (vars not visible to the service); added a presence-only `telegramConfigured` flag to `GET /health` to make that diagnosable without dashboard access, developer re-saved, flag flipped to `true`.
- Forced prod ingestion run: telegram scanned 150 messages → **136 vacancies upserted, 115 canonical after dedup** (`ok` status). Prod E2E through the Vercel web proxy: signup → `GET /vacancies/sources` returns telegram(115)/remoteok(108)/weworkremotely(25) → `sources=telegram` feed returns 115 with `t.me` deep links.
- GitHub Actions cron (every 4h) now keeps Telegram fresh alongside RemoteOK/WWR — no further action needed.
- **Next step:** phase 3 — vacancy↔profile matching, then the Resend digest.

## 2026-07-20 — Telegram source live locally: channels chosen, first real ingest

- Developer obtained `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` and generated `TELEGRAM_SESSION` via `telegram:session` (all three in local `.env`; **still to be set on Render for prod**).
- **Channel selection** (frontend/fullstack focus): probed candidates via `t.me` previews — `@javascript_jobs` and `@fordev` are chats (groups), not channels; `@job_frontend` is a redirect stub. Picked **`job_react`** (React/JS vacancies, ~15.7k), **`geekjobs`** (IT&Digital), **`remote_it_jobs`** (remote IT). Seeded into `sources.config.channels`.
- **First real MTProto run:** 150 messages scanned → 136 vacancies upserted, 115 canonical after dedup. Companies extracted from labeled lines (СДЭК, Альфа-Банк, OZON, VK…), work format on 91/136; salaries rare (3) — channels seldom post them. Known noise: weekly digest posts (e.g. "Вакансии прошедшей недели") pass the length heuristic — candidate for a digest-post filter later.
- **Browser E2E:** feed shows Telegram badges + `t.me` links; checking the Telegram source checkbox narrows 251 → 115 (Page 1 of 6); `GET /vacancies/sources` returns telegram/remoteok/weworkremotely counts; `sources=telegram,weworkremotely` totals add up.
- **Developer TODO for prod:** set the three `TELEGRAM_*` env vars on Render and update the prod `sources` row (`update sources set config = jsonb_set(config, '{channels}', '["job_react","geekjobs","remote_it_jobs"]') where slug = 'telegram';`) or re-run the seed against prod.
- **Next step:** phase 3 — vacancy↔profile matching, then the Resend digest.

## 2026-07-20 — ADR-009 implemented: Telegram worker + feed source filter (v0.3.1)

- **Feed platform filter (phase-2 leftover):** shared `vacancyQuerySchema` gains a `sources` slug-list filter (shape-validated, not a closed enum — sources are DB-driven); `GET /vacancies` filters via the sources join (count query joins too); new `GET /vacancies/sources` returns per-source canonical-vacancy counts for the checkbox options. Web feed: labeled source badges (`sourceLabel`), source checkboxes with counts. Browser E2E: checking WeWorkRemotely narrowed 129 → 25 vacancies with correct badges/pagination.
- **Telegram ingestion worker (phase-1 leftover, primary source):** GramJS/MTProto client reads `sources.config.channels` (usernames without `@`, 50 messages per channel per run), regex-first normalize — title from first line (markdown/emoji stripped), labeled company/location lines (`Компания:`/`Company:`), salary ranges with mandatory currency marker (`$`/`€`/`₽`/`руб`/`usd`/... , `k`/`к` suffixes; bare number ranges are ignored as dates/ids), work-format and employment-type keyword detection (ru+en). `external_id = <channel>:<msgId>`, `url = t.me/<channel>/<msgId>`, fallback company = `@channel`. Missing secrets or empty channel list → polite skip (warn, `notModified`, no `empty` alert); unauthorized session → error. `floodSleepThreshold: 60` honors FLOOD_WAIT. Seeded `telegram` source (active, empty channel list). Processor/module wired; local pipeline run verified the polite-skip path (`last_run_status='ok'`).
- `pnpm --filter @jobradar/api telegram:session` — interactive helper that logs in and prints the session string; `.env.example` documents `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_SESSION`.
- **Fixed a feed hydration mismatch:** `toLocaleDateString(undefined, …)` produced different date formats on server vs client; pinned the locale.
- pnpm 11 `allowBuilds` placeholders (bufferutil/es5-ext/utf-8-validate from GramJS' `ws`) resolved to `false` — optional native accelerators, not needed.
- 110 api + 24 web tests, lint/typecheck/build clean. Version **0.3.1**.
- **Developer TODO to go live with Telegram:** get api id/hash at my.telegram.org, run `pnpm --filter @jobradar/api telegram:session`, set the three `TELEGRAM_*` env vars on Render, and fill `sources.config.channels` for the `telegram` row in prod (plus re-seed or manual SQL).
- **Next step:** phase 3 — vacancy↔profile matching (rules-based), then the Resend daily digest.

## 2026-07-20 — Source strategy pivot: drop hh.ru, Telegram becomes primary (ADR-009)

- **Decision (ADR-009):** hh.ru is dropped for good — its API geo-403s non-CIS IPs and a dev.hh.ru token needs a Russian phone number (a CIS token/IP is barred by ADR-001). It never went live (inactive since 0.2.0); the worker + `HH_API_TOKEN` plumbing is now inactive legacy code.
- **Telegram job channels promoted from phase 4 to the primary v1.0 source.** Read public channels via MTProto (GramJS): `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` (free, my.telegram.org) + a stored user session string; Bot API can't read arbitrary public channels. Per-channel regex parsing first, LLM later (ADR-005). `external_id = <channel>:<msgId>`, `url = t.me/<channel>/<msgId>`. RemoteOK + WeWorkRemotely stay as secondary sources.
- **Product model confirmed: search + link out, no in-app apply.** The feed will show each vacancy's source and gain a platform filter (checkboxes); the "open vacancy" action is a link to the original (Telegram deep link).
- **Docs updated:** ADR-009 + index, DATA_SOURCES (Telegram = source #1, hh moved to Explicitly excluded), PRODUCT (v1.0 scope 3 & 4, rejected list), ROADMAP (hh struck through, Telegram worker + feed source-filter added as open items), CHANGELOG (Unreleased). No code changes yet.
- **Next step:** implement the Telegram ingestion worker and the feed source badge + platform filter.

## 2026-07-20 — Phase 2 production deploy

- Applied migration `0001` (sessions table) to prod Neon over HTTPS (`db:migrate:prod`); verified the `sessions` columns exist. Developer set `API_ORIGIN` on Vercel and `WEB_ORIGIN`/`NODE_ENV` on Render.
- **Gotcha:** the Vercel `API_ORIGIN` had a stray trailing space, so the Next `/api` rewrite proxied to a malformed URL (`/%20/auth/me` reached the API → 404 on every `/api/*`). Next bakes `rewrites()` destinations at **build time**, so fixing the env var requires a fresh build, not just a redeploy. Re-set `API_ORIGIN` cleanly via CLI; an empty-commit trigger was auto-skipped by Vercel (no file changes), so this real commit forces the rebuild.
- **Correct prod value:** `API_ORIGIN=https://jobradar-api-ptvp.onrender.com` (no trailing slash/space).

## 2026-07-20 — Phase 2: application kanban + notes (all phase-2 features built)

- API `applications` module (guarded, user-scoped): `GET/POST /applications`, `PATCH/DELETE /applications/:id`, `POST /applications/reorder` (batch: each affected column with its cards in order, applied in a transaction; `stage_order` = index). `applied_at` stamped via `coalesce(applied_at, now())` when a card reaches applied/screening/tech_interview/offer; unique `(user, vacancy)` → 409. Route order: `reorder` declared before `:id`.
- Shared: `applicationCreateSchema`/`applicationUpdateSchema`/`applicationReorderSchema` (`z.uuid()`), `APPLICATION_STAGES`, `ApplicationItem` (embeds a vacancy summary).
- Web `/app/board`: **@dnd-kit** kanban (developer chose it) — 7 columns, cross-column drag via `onDragOver` (live move) + `onDragEnd` (finalize + persist affected columns), drag handle so notes/buttons stay interactive, `DragOverlay`. Per-card notes editor (PATCH on blur), remove (optimistic). Feed gains a "Save" button (create application; 409 treated as already-saved) and shows "On board ✓" for tracked vacancies (feed page fetches applications for the tracked set).
- **Curl E2E**: create/409-duplicate/list/reorder (appliedAt set on move to applied, source column reindexed)/notes+stage update/401/delete-204-then-404. **Browser E2E**: saved 2 vacancies from the feed → board shows them in Saved → dragged "Graphic Designer" Saved→Applied → **survived a full reload** (server fetch) → feed shows 2 "On board ✓". 98 api + 23 web tests, lint/typecheck/build clean. Version 0.2.5.
- **Phase 2 status:** every feature built and verified locally. **Exit (deployment) is the only remaining gate** — developer TODO: `pnpm db:migrate:prod` (sessions table on Neon), `API_ORIGIN=https://jobradar-api-ptvp.onrender.com` on Vercel, `WEB_ORIGIN`+`NODE_ENV=production` on Render. Do not start phase 3 until deployed.

## 2026-07-20 — Phase 2: vacancy feed (FTS + filters + pagination)

- API `GET /vacancies` (guarded): Postgres FTS via `websearch_to_tsquery('simple', q)` `@@ search_vector`, ranked by `ts_rank` (falls back to `published_at desc nulls last, ingested_at desc` when no query); filters for work format / employment type (`inArray`) and minimum salary (`salaryMax >= min OR salaryMin >= min`); **canonical only** (`canonical_vacancy_id is null`); offset pagination + `count(*)` total; description truncated to 400 chars in SQL; source slug joined in.
- Shared `vacancyQuerySchema` coerces raw query-string values (numeric strings, comma-joined *or* repeated enum params) with a bounded `pageSize` (≤50); `VacancyListItem`/`VacancyFeed` types.
- Web `/app/feed`: SSR first page (`serverApiGet`) + client `FeedBrowser` (search box, format/type checkboxes, min-salary, prev/next). First fetch skipped via a ref (not state — flipping state re-triggers the effect); cards link out to the source. Non-positive salaries (0/0 from RemoteOK) shown as "no salary".
- **Curl E2E** on 129 real local vacancies: default 129/page-1, `q=react`→10 ranked, multi-word `q=python engineer`→3, `workFormat=remote` filter, `pageSize=5&page=2` pagination, 400 on `pageSize=999`, 401 unauthenticated. **Browser E2E**: SSR feed → search "react" narrows to 10 (Page 1 of 1) → 0/0 salary hidden. 90 api + 17 web tests, lint/typecheck/build clean. Version 0.2.4.
- **Next step:** application kanban + notes (last phase-2 item) — likely needs a drag-and-drop lib choice.

## 2026-07-20 — Phase 2: search profile CRUD

- API `profiles` module: `GET/POST /profiles`, `PATCH/DELETE /profiles/:id`, guarded by the session `AuthGuard`, every query scoped to `user.id` (ownership enforced — cross-user reads/patches/deletes return 404). Shared zod contracts: `profileCreateSchema` (with defaults), a *truly* partial `profileUpdateSchema` (zod keeps `.default()` under `.partial()`, so update fields are defined without defaults — otherwise a PATCH would clobber unspecified columns), plus `SearchProfile`, `WORK_FORMATS`, `EMPLOYMENT_TYPES`. Currency uppercased + 3-letter-checked, `salaryMin ≤ salaryMax` refined.
- Web `/app/profiles`: server-rendered initial list (`serverApiGet` forwards the cookie) + client `ProfilesManager` (create/edit/delete with local state), `ProfileForm` (comma-separated tags, enum checkboxes, salary/currency), new `Badge` component; header gains Dashboard/Profiles nav.
- **Curl E2E**: create (currency `usd`→`USD`), list, partial PATCH (rename+deactivate keeps keywords), 400 on `salaryMin>salaryMax`, 401 unauthenticated, ownership 404 for another user, delete 204 then 404. **Browser E2E**: SSR list → New profile form → created card (Remote/Full-time badges, keywords, stack, `5000–8000 USD`). 83 api + 14 web tests, lint/typecheck/build clean. Version 0.2.3.
- **Next step:** vacancy feed — filters, Postgres FTS on `search_vector`, pagination (canonical vacancies only).

## 2026-07-20 — Phase 2: web foundation + auth UI

- Stood up the real web app on **Tailwind v4 + a hand-rolled shadcn/ui component set** (Button/Input/Label/Card, light/dark theme tokens). Set up the `@/*` alias in vitest too.
- Auth UI wired to the backend: `/login` + `/signup` share an `AuthForm` (client-side zod validation via the shared schemas, API error surfacing), auth-protected `/app` with a server layout that resolves the user from the session cookie (`getCurrentUser`, forwards the cookie to the API server-side) and redirects to `/login` when absent/expired; `AuthProvider` + `AppHeader` (email + logout); `middleware.ts` gates `/app` on cookie presence (no redirect loops — real check stays server-side).
- **Same-origin `/api` proxy** via Next rewrites (`API_ORIGIN`, defaults to local :3001) keeps the session cookie first-party. `SESSION_COOKIE_NAME` moved to `@jobradar/shared` (one source for api + web).
- **Live browser E2E** (in-app browser vs local API+web): `/` → `/app` → `/login` guard redirect ✓; signup → httpOnly cookie set through the proxy (`document.cookie` empty) → `/app` renders the header with the user's email ✓; logout → `/login` ✓; wrong-password login surfaces the 401 message ✓. 73 api + 10 web tests, lint/typecheck/build clean. Version 0.2.2.
- **Deploy prep (developer, when deploying the web auth):** run `pnpm db:migrate:prod` (sessions table on Neon); set `API_ORIGIN=https://jobradar-api-ptvp.onrender.com` on Vercel; set `WEB_ORIGIN` + `NODE_ENV=production` on Render (so the cookie is `secure`).
- **Next step:** search-profile CRUD (api module + web UI).

## 2026-07-20 — Phase 2: auth backend (email + password, sessions)

- Decisions (developer): **email + password** auth first (self-managed in NestJS — best fit for the "real backend / guards" learning goal and the zero-budget constraint, no external auth service); **Tailwind + shadcn/ui** for the web UI (next chunk). Cross-origin cookie problem solved by proxying `/api` through the web app (Next rewrites) so the session cookie stays first-party — routing, not backend logic, so ADR-002 holds.
- `sessions` table (opaque 256-bit token, per-user, `expires_at`) + migration `0001`; applied to local Postgres. **Prod (Neon) migration still to run before web deploy: `pnpm db:migrate:prod`.**
- Auth module: `signup`/`login`/`logout`/`me`. Passwords via Node stdlib **scrypt** (memory-hard, no native dep; had to raise `maxmem` above the 32 MB default for N=2^15). Session in an httpOnly `SameSite=Lax` cookie (`secure` in prod). `AuthGuard` + `@CurrentUser()` decorator. Login uses a constant-time dummy verify so timing doesn't leak whether an email exists.
- Shared **zod** contracts in `@jobradar/shared` (reused by web later), validated on the API through a `ZodValidationPipe`.
- Live E2E against local DB (curl + cookie jar): signup→me→logout, 401 without/after-logout cookie, 409 on duplicate email (drizzle wraps the pg error — unique-violation detected via the `cause` chain), 400 on invalid payload, 401 on wrong password. 73 api tests green, web 2, lint clean. Version 0.2.1.
- **Next step:** web foundation — Tailwind + shadcn/ui, Next `/api` proxy rewrites, login/signup pages, session context, protected app shell.

## 2026-07-20 — Phase 1 complete 🎉 (WWR replaces hh as second source)

- dev.hh.ru registration turned out to require a Russian phone number (developer has none) + an application review wait → hh deferred indefinitely per DATA_SOURCES.md "pick one of #2/#3": implemented the **WeWorkRemotely RSS worker** (fast-xml-parser, `Company: Title` split, conditional GET with 304-aware status) and activated it; hh source set inactive (worker + `HH_API_TOKEN` support stay ready).
- Local E2E: WWR 25 vacancies, dedup across 129 candidates. Prod E2E after deploy: **remoteok 100 + weworkremotely 25 vacancies in Neon, both `ok`**; hh excluded from runs.
- **Phase 1 exit criterion met** → ROADMAP marker moved to phase 2, version 0.2.0.
- **Next step:** phase 2 — auth + sessions, then search-profile CRUD.

## 2026-07-20 — Prod ingestion live (remoteok); hh needs app token

- Remotely debugged the Render env setup purely via `/health` diagnostics (no dashboard access): `REDIS_URL` was pasted as non-TLS with a masked-asterisks password → forced TLS for `*.upstash.io` hosts in code, surfaced the real ioredis error (`WRONGPASS`), developer re-copied the password → `redis: ok`.
- Render's `INGESTION_TOKEN` ended up being the local dev value → synced the GH Actions secret to match (single token now, noted in `.env`).
- **Production E2E: `POST /ingestion/run` → 100 RemoteOK vacancies in Neon, source `ok`, dedup ran (0 false links).** Seeded the author's real user (batashof@gmail.com) + "Senior React remote" profile into prod so hh has a query.
- hh.ru from Render IPs: same geo-403 as from the dev machine → `last_run_status: error`. Added optional `HH_API_TOKEN` support (Bearer + HH-User-Agent). **Developer action:** register an app at dev.hh.ru, put the token into Render env as `HH_API_TOKEN`.
- Version 0.1.6. **Phase 1 exit:** everything deployed and working except live hh data (external policy, pending token) — phase stays open on that single caveat.

## 2026-07-20 — Fix: env-var crash on Render + health diagnostics

- After the developer added env vars, the Render deploy failed in ~24s (no rebuild → bootstrap crash). Only bootstrap-time env parsing we have is `new URL(REDIS_URL)` → hardened: trim + strip pasted quotes, validate scheme, return null and log instead of throwing; app boots with queue idle.
- `/health` now returns `checks` (db/redis reachability with 1.5s timeouts, redis host sans credentials, ingestion-token presence) — prod is self-diagnosing without dashboard log access (Claude-in-Chrome has no access to dashboard.render.com).
- 43 api tests green. Version 0.1.5.

## 2026-07-19 — Phase 1: dedup v1 + ingestion cron

- Dedup v1 per ADR-004 as pure TS (no pg_trgm needed): trigram/Dice title similarity, grouped by `company_normalized` (skipping unknown/empty), ±14-day window on published (fallback ingested), earliest-ingested stays canonical, chains compressed. Runs as a `dedup` queue job enqueued after all source jobs (FIFO, concurrency 1). 11 unit tests.
- E2E verified: synthetic cross-source duplicate got linked (101 candidates, 1 linked, zero false positives on 100 real RemoteOK vacancies).
- GitHub Actions ingestion cron every 4h (`17 */4 * * *`) + manual dispatch with `force`; tolerates Render cold starts (150s timeout, retries); exits as a warning-level no-op while the API lacks `INGESTION_TOKEN` (so scheduled runs aren't red before prod env is configured). Secret `INGESTION_TOKEN` set in the repo; the same value is stored as `INGESTION_TOKEN_PROD` in local `.env` — **developer: copy it to Render env vars**.
- Fixed `.env` resolution to be cwd-independent (resolved from compiled module path).
- Version 0.1.4. **Remaining for phase 1 exit:** Upstash Redis + Render env vars (`DATABASE_URL`, `REDIS_URL`, `INGESTION_TOKEN`), then verify ingestion + hh geo-403 from prod.

## 2026-07-19 — Phase 1: ingestion workers (hh.ru + RemoteOK) over BullMQ

- Wired BullMQ (`@nestjs/bullmq`) with Redis from `REDIS_URL`; `POST /ingestion/run` (bearer `INGESTION_TOKEN`, timing-safe) enqueues a job per active source; processor enforces the 4-hour politeness interval and writes `last_run_at`/`last_run_status`.
- hh.ru worker: queries per active search profile, pagination + page delays, honest UA, 429 handling; full normalizer with tests. **Caveat:** live hh API returns geo-403 from this network (any UA) — worker is unit-tested but not E2E-verified; retry from Render's IPs or register an hh app token (dev.hh.ru). No proxies per politeness rules.
- RemoteOK worker: JSON feed, link-back URLs per their terms, HTML-stripped descriptions. **E2E verified locally: 100 real vacancies ingested, source status `ok`; auth hook rejects requests without token (401).**
- 26 api unit tests green. Version 0.1.3.
- **Next step:** dedup v1 (ADR-004) and GitHub Actions cron (ADR-006); Upstash Redis + Render env vars for prod.

## 2026-07-19 — Phase 1: Neon production DB provisioned

- Developer created the Neon project (twilight-boat-64185932, Frankfurt, Postgres 18); connection string stored in local `.env` as `DATABASE_URL_PROD` (gitignored).
- This network blocks outbound TCP 5432, so `drizzle-kit migrate`/plain `pg` can't reach Neon from here → added `db:migrate:prod` (`neon-apply.ts`) which applies migrations + source seed over HTTPS via `@neondatabase/serverless` (drizzle `neon-http` migrator). Render itself will use plain `pg` over TCP.
- Verified: all tables exist in Neon, sources seeded (`hh`, `remoteok` active).
- Still needed on Render (developer, later): `DATABASE_URL`, `REDIS_URL` (Upstash — account not created yet), `INGESTION_TOKEN` env vars.

## 2026-07-19 — Phase 1: seed data

- Idempotent `db:seed` (tsx): upserts the source registry by slug — `hh` (api) and `remoteok` (api, link-back note per their terms) active, `weworkremotely` (rss) registered but inactive per DATA_SOURCES.md "pick one of #2/#3".
- Dev fixtures (user `dev@jobradar.local` + "Senior React remote" profile) seeded only when `NODE_ENV !== 'production'`.
- Verified against local Postgres: rows present, second run adds nothing. Unit tests for seed data. Version 0.1.2.
- **Next step:** hh.ru ingestion worker (fetch, normalize, upsert) — needs BullMQ + Redis wiring first.

## 2026-07-19 — Phase 1: ADR-008 (Drizzle) + full DB schema & migrations

- **ADR-008**: Drizzle over Prisma — generated `tsvector` + GIN index expressible in schema (Prisma needs `Unsupported()` + hand-written SQL), enum arrays / composite PKs first-class, no query engine (fast cold starts on sleeping Render).
- Implemented the entire DATA_MODEL.md schema in `apps/api/src/db/schema.ts`; generated and applied `0000_init-schema.sql` to local Postgres.
- Verified live: FTS query via `search_vector @@ to_tsquery('simple', 'react & typescript')` finds an inserted vacancy; FK constraints enforce delete order. `search_vector` uses `simple` config (mixed RU/EN sources) — noted in DATA_MODEL.md for future relevance tuning.
- Nest wiring: global `DbModule` (lazy `pg` Pool — app still boots without a DB, keeps hello-world deploy alive) + `ConfigModule` reading repo-root `.env`.
- 6 schema unit tests via `getTableConfig` (no DB needed — CI-safe). Version 0.1.1.
- **Next step:** seed data, then hh.ru ingestion worker. Also: provision Neon Postgres and set `DATABASE_URL` on Render before ingestion goes live.

## 2026-07-19 — Phase 0 complete: both apps deployed 🎉

- Developer created Vercel + Render accounts and connected the repo (Vercel root directory `apps/web`, Render via `render.yaml` blueprint).
- Render deploy succeeded as-is: <https://jobradar-api-ptvp.onrender.com/health> returns the health JSON.
- First Vercel build failed (`Module not found: @jobradar/shared` — shared's `dist/` isn't built by plain `next build`). Fixed with `apps/web/vercel.json` buildCommand that builds `@jobradar/shared` first. Second build green: <https://job-radar-web-phi.vercel.app> (note: `job-radar-web.vercel.app` without suffix belongs to someone else's project).
- Phase 0 exit criterion met (both apps over HTTPS, CI green) → ROADMAP marker moved to **phase 1 — Data core**, version **0.1.0**.
- TODO for phase 2 (auth): set `WEB_ORIGIN` env var on Render to the Vercel URL to tighten CORS; set `NEXT_PUBLIC_API_URL` on Vercel when the web app starts calling the API.
- **Next step:** phase 1 — ORM choice (ADR-008), then schema + migrations.

## 2026-07-19 — Phase 0: deployment prep (ADR-007, Dockerfile, render.yaml)

- Hosting research: Railway (no free tier, $5 trial only) and Fly.io (no free tier, card required) both violate ADR-001 → **ADR-007**: API goes to Render's free Docker tier (sleep-after-15-min is already mitigated by ADR-006 cron wake-up). Koyeb is the recorded fallback.
- Added `apps/api/Dockerfile` (multi-stage: filtered pnpm install → build shared+api → `pnpm deploy --legacy --prod` bundle; runs as `node` user) and `.dockerignore`. Verified: image builds, container serves `/health`.
- Added `render.yaml` blueprint; docs synced (ARCHITECTURE diagram/tables, README stack, ROADMAP; ORM ADR renumbered 007→008).
- Installed Vercel CLI 56 via brew. Version bumped to 0.0.5.
- **Blocked on developer:** `vercel login` + linking the repo to a Vercel project (root directory `apps/web`), and creating/connecting a Render account to apply `render.yaml`. Deploy checkbox stays unticked until both hello worlds are live.

## 2026-07-19 — Phase 0: CI pipeline

- Added GitHub Actions workflow: single `checks` job (build → lint → typecheck → test) on `pull_request` and on pushes to `main`; pnpm version taken from `packageManager`, node_modules cached, `--frozen-lockfile`, concurrent runs on the same ref auto-cancelled.
- Verified by watching the first run on `main` complete green.
- Version bumped to 0.0.4.
- **Next step:** hello-world deployments (Vercel for web, Railway/Fly.io for api) — the last phase 0 item.

## 2026-07-19 — Tooling: Homebrew reinstalled, Docker Compose verified

- Reinstalled Homebrew on the dev machine: the old install (Feb 2025) predated macOS 26 and was broken; replaced with fresh Homebrew 6.0.11 (official tarball into `/opt/homebrew`, no sudo needed). Only loss from the old install: an unused duplicate `node@22` (system Node lives in `/usr/local/bin`).
- Installed colima 0.10 + docker CLI + docker-compose via brew; `colima start --cpu 2 --memory 4` runs the Docker daemon.
- Verified the compose stack for real: `docker compose up -d` → both `postgres` and `redis` report healthy; smoke-tested a psql query (PostgreSQL 17.10) and Redis SET/GET. This closes the caveat from the entry below.
- Containers left running for development.

## 2026-07-19 — Phase 0: Docker Compose for local dev

- Added `docker-compose.yml` (Postgres 17-alpine + Redis 8-alpine, healthchecks, named volumes, AOF persistence for Redis) and `.env.example` with matching connection strings; README Development section updated.
- YAML validated with yaml-lint. **Caveat:** could not run `docker compose up` on this machine — no container runtime installed, and Homebrew is broken (needs `sudo chown -R vladislav /opt/homebrew` + `brew update`; current brew predates macOS 26). Verify compose once Docker/OrbStack/colima is installed.
- Version bumped to 0.0.3.
- **Next step:** CI on PR (lint + typecheck + tests), then hello-world deployments (Vercel + Railway/Fly.io).

## 2026-07-19 — Workflow rules & frontend test setup

- CLAUDE.md: added two mandatory conventions — (1) commit & push after every coherent chunk of work, (2) every web/api change ships with tests (web: Vitest + React Testing Library, api: Jest).
- Added Vitest + React Testing Library to `apps/web` with home-page tests (`vitest.config.mts`, `app/page.test.tsx`); `pnpm test` now runs real tests in both apps.
- Note: Vitest `globals: true` is required so Testing Library auto-cleans the DOM between tests.
- **Next step:** Docker Compose for local dev (Postgres + Redis), then CI.

## 2026-07-19 — Phase 0: monorepo scaffold

- Scaffolded the pnpm-workspaces monorepo: `apps/web` (Next.js 16, App Router), `apps/api` (NestJS 11), `packages/shared` (shared types/constants), per ARCHITECTURE.md.
- API exposes `GET /health` returning `HealthResponse` from `@jobradar/shared`; covered by a Jest unit test. Web hello-world page uses `APP_NAME` from the shared package.
- Tooling: strict `tsconfig.base.json`, ESLint 9 flat configs (eslint-config-next / typescript-eslint), root `build`/`lint`/`typecheck`/`test` scripts.
- Pinned TypeScript 5.9 and ESLint 9 (TS 7 / ESLint 10 are not yet supported by ts-jest, typescript-eslint and Next lint plugins).
- Verified locally: workspace build, typecheck, lint, tests all pass; both apps boot and serve (API `/health`, web homepage).
- Version bumped to 0.0.2 (CHANGELOG updated, root `package.json` version in sync).
- **Next step:** Docker Compose for local dev (Postgres + Redis), then CI (lint + typecheck + tests on PR).

## 2026-07-19 — Project bootstrap: documentation & repository

- Turned the original planning document (docs/original-plan.ru.md) into a full English documentation set: PRODUCT, ARCHITECTURE, DATA_MODEL (draft), DATA_SOURCES, ROADMAP, RISKS.
- Recorded key decisions as ADRs 001–006.
- Created CLAUDE.md with context rules, worklog and versioning conventions.
- Initialized git repository, published to GitHub (batashof/JobRadar).
- Version set to 0.0.1 (documentation only, no code yet).
- **Next step:** Phase 0 — monorepo scaffold (`apps/web`, `apps/api`, `packages/shared`), Docker Compose, CI, hello-world deployments.
