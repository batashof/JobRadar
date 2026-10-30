# Roadmap

> **Current phase: 5 — Telegram-only product (ADR-024, ADR-025). v2.0.0 released 2026-10-16 with the website kept as the author's cabinet (ADR-028); 5.7 bot UX polish done in v2.0.1; 5.8 delivery without the LLM in v2.1.0 (ADR-029); 5.9 onboarding in the bot in v2.3.0; 5.10 settings and filters apart in v2.4.0; 5.11 vacancy card and location filter in v2.5.0; 5.14 working language of a vacancy in v2.7.0; 5.15 a profile without a resume in v2.8.0; 5.16 a daily delivery quality audit in v2.9.0 (ADR-035); 5.17 resume profile accuracy in v2.10.0; 5.18 backend-stack rule in v2.11.0 (ADR-036). Remaining: testers (developer), optional sources, the website's removal when the developer asks.** Phase 4 is deployed and closed (2026-10-15); its open items are listed under phase 4 as dropped or moved. v1.0 released 2026-07-20.
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
- [x] ~~hh.ru ingestion worker~~ — **dropped (ADR-009)**. *(worker + `HH_API_TOKEN` implemented but never went live — hh geo-403s non-CIS IPs and dev.hh.ru needs a Russian phone; a CIS token/IP is barred by ADR-001. Inactive legacy code; Telegram replaces it as the primary source.)*
- [x] RSS/JSON ingestion worker (RemoteOK or WeWorkRemotely). *(RemoteOK JSON + WWR RSS live in prod; extended with three more free no-auth JSON feeds — Remotive, Jobicy, Working Nomads, 2026-07-21)*
- [x] **Telegram job-channel ingestion worker (primary source, ADR-009)**: MTProto/GramJS reads configured public channels, per-channel parse (regex first, LLM later), normalize + upsert; `t.me` deep link as the vacancy URL. Needs `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` + a stored session string (secrets). *(worker + regex parser + `telegram:session` helper shipped; skips politely until the secrets and `sources.config.channels` are set)*
- [x] Deduplication v1 (heuristic, ADR-004). *(trigram title similarity + company + 14-day window; E2E verified locally)*
- [x] GitHub Actions cron hitting the ingestion hook every 4 hours (ADR-006). *(runs no-op with a warning until Render env vars are set)*

**Exit criterion:** vacancies from two sources appear in the DB automatically, duplicates linked, deployed. ✅ *(2026-07-20: RemoteOK + WWR live in prod, 125 vacancies, cron verified)*

## Phase 2 — User & UI (~2 weeks)

- [x] Auth + sessions (email+password or GitHub/Google OAuth). *(email+password, scrypt, server-side sessions; web login/signup/logout live)*
- [x] Search profile CRUD. *(NestJS profiles module, guarded + user-scoped; web manager UI; browser E2E verified)*
- [x] Vacancy feed: filters, Postgres FTS, pagination. *(GET /vacancies: websearch_to_tsquery FTS + ts_rank, work-format/employment/salary filters, canonical-only, paginated; web feed browser — verified on 129 real vacancies)*
- [x] Feed: show **source** per vacancy + **platform filter (checkboxes)** (ADR-009). *(`sources` query filter + `GET /vacancies/sources` options endpoint; labeled source badge + checkbox filter with counts in the feed — browser E2E verified)*
- [x] Application kanban: drag-and-drop, 5 stages (+ rejected/withdrawn), ordering. *(@dnd-kit board, cross-column move persisted via reorder endpoint; save-to-board from the feed; browser E2E verified)*
- [x] Notes on applications. *(per-card notes editor, PATCH on blur)*

**Exit criterion:** the author can browse, search, and track applications in production. ✅ *(2026-07-20: deployed on Vercel + Render + Neon; prod E2E through the web proxy — signup→cookie→me, feed 128 vacancies, profile CRUD, 401 when unauthenticated — all green.)*

## Phase 3 — Delivery & notifications (~1–2 weeks)

- [x] Vacancy ↔ profile matching (rules-based). *(scorer: hard filters + keyword/stack hits with Unicode word boundaries; materialized in `profile_matches` by a `match` queue job after each ingestion cycle and on profile create/update; `GET /matches` + web Matches page — E2E verified locally)*
- [ ] ~~Daily email digest via Resend + unsubscribe link~~ — **deferred by developer decision (2026-07-20)**; revisit after v1.0. Matches are delivered in-app via the Matches page instead.
- [x] Reminders: "no answer for N days — follow up" *(in-app, since the email digest is deferred: `GET /applications/reminders` (waiting stages past `remind_after_days` / 7-day default), dashboard "Follow-ups due" list, board card hints + per-card threshold input — E2E verified locally)*.
- [x] **Release v1.0**: domain *(the free `job-radar-web-phi.vercel.app` subdomain — a paid custom domain stays optional under ADR-001)*, ~~Sentry on both apps~~ ✅ *(2026-07-20, ADR-010: `@sentry/nestjs` + `@sentry/nextjs`, DSN-gated no-op when unset; `sentryConfigured` in /health)*, README with screenshots ✅ *(2026-07-20: rewritten with shipped scope, stack, and 4 screenshots)*.

**Exit criterion:** v1.0 live and used daily by the author. ✅ *(2026-07-20: v1.0.0 tagged; developer TODO — set Sentry DSNs in the Render/Vercel dashboards)*

## Phase 4 — Extensions (optional, after v1.0; order by appetite)

### Apply assistant (resume-driven, ADR-011)

- [x] Resume upload (PDF): store in Postgres (`resumes` table), extract text server-side at upload; manage on a settings/profile page. *(POST/GET/DELETE /resumes + :id/file download + :id/activate; pdf-parse extraction, magic-byte validation, 5 MB cap; web /app/resume page — E2E verified locally)*
- [x] Vacancy detail page: clicking a vacancy in the feed/matches opens the full stored description in-app (source link stays available); all assistant actions live here. *(GET /vacancies/:id + /app/vacancies/[id]; card titles now link internally, "Open original ↗" preserved — browser-verified locally)*
- [x] LLM gateway module per ADR-005 (ordered free providers, failover, caching) — shared by all features below. *(`llm/` gateway: Groq → OpenRouter → Gemini, failover, 503 when keyless; `llmProviders` in /health — live-verified 2026-07-21)*
- [x] LLM resume ↔ vacancy matching: score + short fit explanation, only for vacancies passing rules-based profile matching; cached permanently in `resume_matches` (one LLM call per resume × vacancy). *(budget-capped run — 10/cycle — rides the `match` job and is manually triggerable via POST /matches/resume-score; CV % badge + RU explanation on the Matches page; skips cleanly without an LLM key)*
- [x] On-demand Russian vacancy brief (button on the detail page): employer, what they do, how well it fits; cached on the vacancy. *(POST /vacancies/:id/brief, cached in `summary_ru`, `?force=true` regenerates; fit section uses the active resume when present. Live LLM run still needs a free API key in env — degrades to a friendly 503 until then, browser-verified)*
- [x] On-demand cover letter (button): vacancy's language, English calibrated to the resume's evident level, short and dense, foregrounds real relevant experience; editable before sending. *(POST /vacancies/:id/cover-letter, prompt pins language/level/length/honesty rules; editable textarea on the detail page; same LLM-key caveat)*
- [x] Apply-contact extraction at ingestion (email / Telegram handle / apply URL; regex first, LLM fallback later); shown on the detail page. *(extractor in the upsert choke point + `backfill:contacts` script — 67/275 local vacancies got a contact; detail page renders mailto/t.me links)*
- [x] Email apply via Gmail API (OAuth, `gmail.send`, user's own account): LLM-generated subject + body, cover letter included, resume PDF attached, recipient pre-filled from the extracted contact (editable); explicit user confirmation before every send; sent applications recorded (`outreach_emails`) and reflected on the kanban. *(OAuth connect flow with HMAC-signed state + AES-GCM-encrypted refresh token; draft → edit → confirm UI; needs `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in env — a live send awaits those creds, UI degrades to "not configured" until then)*

### Feed-centric resume relevance (ADR-012)

- [x] Removed the Matches page; the Feed is the single browse surface (Profiles + rules-based matching kept in the background). *(nav/page/component removed; dashboard copy updated)*
- [x] On-demand resume-fit on the vacancy page: LLM score cached in `resume_matches`, colour-banded circular gauge + RU rationale; cached `CV %` badge on feed cards. *(A — live-verified 2026-07-21: React-Native vacancy vs frontend resume → 40% with an accurate gap explanation)*
- [x] Soft resume-driven seniority filter in the feed: `vacancies.seniority` detected at ingestion (rules, no LLM), toggle hides roles ≥2 grades below the resume; unknown level always passes. *(B — live-verified: senior resume 251 → 239)*

### Interview prep (resume-driven, ADR-013)

Standalone prep module inside JobRadar (no new service/infra): `interview/` on the API, `/app/interview` on the web, all generation on-demand + cached through the ADR-005 LLM gateway. *(Complete — shipped over two increments 2026-07-21: v1.3.0 plan/progress/questions/live-coding, v1.4.0 mock interview.)*

- [x] Schema: `interview_plans`, `interview_topic_progress`, `interview_questions`, `interview_answers` + `interview_sessions` ([DATA_MODEL.md](DATA_MODEL.md)) — migrations `0005`, `0006`.
- [x] Prep-plan generation from the active resume (+ optional target role / seniority / focus): LLM builds sections → topics; stored once, regenerate on explicit action. *(live-verified 2026-07-21: 12-topic senior-frontend plan grounded in the resume, incl. its self-identified algorithms gap)*
- [x] Per-topic progress tracking (todo / in_progress / done + self-confidence); the plan doubles as a persistent checklist. *(status persisted via upsert; done/total counter)*
- [x] Question generation per topic (theory / behavioural / coding, chosen difficulty); model answers generated on-demand and cached.
- [x] Live-coding tasks: in-app editor, LLM reviews the submitted solution (correctness, complexity, edge cases, style) with a score — **no code execution** (ADR-001). *(live-verified: virtual-list task scored 0.85 with an accurate overscan/key critique)*
- [x] Mock interview: turn-based text chat, LLM interviewer calibrated to resume + target role; written feedback report on completion; transcript persisted. *(v1.4.0 — start/reply/finish endpoints, chat UI at `/app/interview/mock`; live-verified 2026-07-21: resume-grounded opening, reactive follow-up, 85% feedback report)*

### Day planner (accountability loop, ADR-015)

A personal execution surface over existing app state: `planner/` on the API, `/app/day` on the web, plus a Telegram **bot** channel. Not a calendar — an ordered queue of timeboxes with a morning-accept / evening-close ritual, a focus timer, rolling debt, and escalating nudges. *(ADR-015 accepted 2026-07-23; increment 1 in v1.7.0 — schema, candidates, manual plan; increment 2 in v1.8.0 — timer, close-out, estimation factor; increment 3 in v1.9.0 — LLM composition; increment 4a in v1.10.0 — tick, auto-close, in-app nudges.)*

- [x] Schema + migration `0008`: `planner_settings`, `day_plans`, `plan_blocks`, `focus_sessions`, `planner_nudges` ([DATA_MODEL.md](DATA_MODEL.md)).
- [x] Candidate collection (plain SQL, no LLM): due follow-ups, `todo`/`in_progress` prep topics, fresh matching vacancies, manual backlog, carried debt. *(browser-verified 2026-07-23: all four kinds on one screen, already-planned items disappear from the list)*
- [x] Plan generation: one LLM call per plan (ADR-005 gateway, `users.language`) selecting + sequencing candidates within the corrected capacity; deterministic fallback ordering when no LLM key is available. *(live-verified both paths: with keys → `llm`, keys blanked → `fallback`; hallucinated keys are dropped on parse)*
- [x] Morning ritual: explicit plan acceptance (app; the bot path comes with the nudge increment) — until accepted the day counts as unplanned.
- [x] Block queue UI: add from candidates or by hand, reorder, edit estimates, drop-with-reason, day intent. *(deep links into the source application / topic / vacancy still open — `sourceRef` is stored)*
- [x] Focus timer: start / pause / resume / stop → `focus_sessions`, `actual_minutes` on the block. *(one running session per user; starting another block auto-pauses the first — live-verified)*
- [x] Evening close-out: per-block `done` / `partial` / `skipped` + reason, day review stored on the plan, auto-close at end of day marking unresolved blocks `unreported`. *(manual close in v1.8.0; the tick's automatic close in v1.10.0 — live-verified on a stale open day)*
- [x] Rolling debt: carry unfinished blocks into the next plan first, `carry_count`, rotting (≥3) pinned + escalated, explicit drop-with-reason as the only other exit. *(close-out now produces the unfinished blocks that the candidate collector offers back the next day)*
- [x] Estimation calibration: `estimation_factor` (global + per category) from the last N blocks, surfaced on the day surface and applied to new blocks. *(median over ≤20 timed blocks, needs ≥5, clamped to [0.5, 4]; live-verified ×2.00 after five 30→60 min blocks)*
- [x] `planner:tick` BullMQ repeatable job (1 min): due nudges, midway checks, day rollover per timezone, idempotent claim-before-send. *(live-verified: stale day auto-closed, morning + debt + block_start raised once each, escalation repeated then recorded as ignored)*
- [x] Telegram bot channel: `TELEGRAM_BOT_TOKEN` outbound `sendMessage` + `POST /bot/telegram/webhook` (secret-token guarded), inline *Start / Done / Skip*. *(v1.16.0 — shipped as a shared `bot/` module rather than a planner-private one, since the digest needs the same channel: account linking via a `t.me` deep link, callback routing by namespace, and nudge delivery on the existing `planner_nudges` rows. Endpoint moved from `/planner/telegram/webhook` to `/bot/telegram/webhook`; *+15 min* was dropped in favour of Start/Done/Skip, which map onto the planner actions that already exist.)*
- [ ] ~~Planner stats on the dashboard~~ — dropped with the web app (phase 5, ADR-024).

### Other extensions

- [ ] ~~LLM relevance scoring + description summarization~~ — superseded: owner has the LLM verdict (ADR-022), everyone else the formula (ADR-025).
- [x] **Daily vacancy digest in Telegram** — up to 10 resume-matched vacancies per send, with an *Apply* button that shortens the path to a sent resume + cover letter.
  - [x] Bot channel (v1.16.0) — linking, outbound send, inline buttons, webhook.
  - [x] Schedule configuration (v1.17.0) — `digest_settings`: on/off, 1–4 send times a day in the user's timezone, per-send cap, resume-fit floor; `GET`/`PATCH /digest/settings` + a card on the day surface.
  - [x] The send itself (v1.18.0) — `digest_items` (never repeat a vacancy), the SQL → level-gate → one-batch-LLM funnel, an in-process scheduler on the per-user local times, Telegram cards with *Apply* / *Details* / *Hide* / 👍👎, and a "send it now" button.
  - [x] Instant delivery mode (v1.22.0, ADR-020) — push new matches right after each ingestion run instead of at fixed times, with quiet hours and a stricter floor.
  - [x] The three apply paths keyed on `vacancies.apply_contact` (v1.19.0): `email` → draft + confirm + send via Gmail; `telegram` → ready-made text plus a link to the chat; `url`/absent → the letter plus links into the app and the posting.
- [x] **LinkedIn via job-alert emails** (v1.23.0, ADR-021) — the alerts LinkedIn mails the user, read over IMAP (read-only, dedicated mailbox recommended); one vacancy per card, no request to linkedin.com. `linkedin:alerts:preview` checks the parse against real mail.
- [ ] ~~Browser extension: one-click "Save to JobRadar"~~ — dropped (ADR-024); forwarding a link to the bot replaces it, and Djinni gets an RSS source in phase 5.4.
- [x] More sources: **Remotive, Jobicy, Working Nomads** (free no-auth JSON feeds, 2026-07-21); **Himalayas + HN "Who is hiring?"**, WWR across five category feeds, Jobicy across four industries (2026-07-28, ADR-016 — RemoteOK dropped in the same pass). *(Telegram channels promoted to a v1.0 primary source — ADR-009.)* Also **company career pages via Greenhouse/Ashby/Lever** (36 curated boards, 2026-07-28). Still open: Djinni.
- [x] Funnel statistics: applied → screening → interview → offer conversion. *(`furthest_stage` column tracks the deepest non-terminal stage each application ever reached, so rejected/withdrawn cards still count through their peak; `GET /applications/stats` + dashboard Funnel card with per-step conversion — E2E verified)*
- [ ] ~~Google Calendar sync for interviews (OAuth)~~ — dropped (ADR-024).

## Phase 5 — Telegram-only product, v2.0.0 (ADR-024, ADR-025)

JobRadar opens to other job seekers, and the Telegram bot becomes the whole product: registration, resume upload and evaluation, matching, every setting. The LLM reads a resume once at registration; vacancies are scored by a formula. Each step below is one PR with tests, a minor version bump and a deploy; the next step starts once the previous one is in production. The web app keeps running until step 5.6 removes it, which is the 2.0.0 release.

### 5.1 Registration in the bot (v1.26.0) ✅

- [x] `users.telegram_user_id` (unique), `users.role` (`owner` / `user`), `users.email` optional — migration `0019`; every pre-existing account becomes `owner` and keeps its chat link.
- [x] `/start` from an unknown Telegram user creates the account and its chat link in one step; a known one whose chat was unlinked is reconnected, not duplicated; `/start <token>` keeps linking the author's web account and now remembers the Telegram user id.
- [x] Interface language from the Telegram client (`language_code` → `ru` / `en`, ADR-014). *(Changing it moves to `/settings` in 5.3.)*
- [x] Owner-only flag (`role = 'owner'`): handlers receive the role; the in-chat Apply (LLM draft) refuses non-owners, the LLM-verdict digest runs only for owners. *(The web-only features — brief, cover letter, interview, planner, Gmail, LinkedIn IMAP — are unreachable for bot-made accounts, which have no web login.)*
- [x] Commands: `/help`, `/privacy` (text in the chat; the landing-page URL comes in 5.6), `/delete` (confirm button → one `DELETE FROM users`, everything cascades; refused for the owner).
- [x] `events` table (`start`, `account_deleted`) for the activation funnel; later steps add theirs. *(`bot_dialogs` moves to 5.2, its first consumer.)*

**Exit criterion:** a stranger presses Start and has an account with no website involved; `/delete` removes it.

### 5.2 Resume upload and evaluation (v1.27.0) ✅

- [x] `bot_dialogs`: per-chat dialog state in Postgres (flow, step, payload, 30-minute expiry); `BotService.registerDialog(flow, handler)` routes typed text to the flow that asked.
- [x] A PDF sent to the chat is downloaded through `getFile` (our cap stays 5 MB), stored in `resumes`, text extracted as today; non-PDF, oversize and scan-only files get a clear answer.
- [x] `candidate_profiles` + one LLM call → zod-validated profile and resume evaluation (ADR-025 §1); prompt version stored.
- [x] Provider chain for non-owners: `LLM_RESUME_PROVIDERS`, default `groq` only (Gemini is always dropped; OpenRouter opt-in once its account forbids training); 3 analyses per 30 days, owner exempt; lexical fallback profile when every provider fails, with an "Analyse again" button as the retry.
- [x] The evaluation message (strengths, gaps, what to add) and the profile card with `p:` buttons: confirm, role, grade, English (pickers) and skills (typed list). *(Location stays as the analysis read it; it becomes a setting in 5.3 with the timezone.)*

**Exit criterion:** a PDF in the chat → evaluation and a confirmed profile within a minute.

### 5.3 Matching and settings in the bot (v1.28.0)

- [x] `matching/score.ts` pure scoring function + synonym / adjacent-tech dictionary in `packages/shared`; template explanation on each card.
- [x] Compare with the author's `resume_matches` (ADR-025 §9, gate amended by ADR-026): precision 85% (17 of the formula's top 20 rated ≥80 by the LLM) against the ≥70% bar; top-20 overlap 15% kept as a diagnostic. `DB (prod)` → `formula:check`.
- [x] Digest funnel for non-owners on the formula; owner keeps the LLM verdict.
- [x] 👍 / 👎 / Hide adjust skill and company weights within bounds. Superseded on the card the same day: the developer asked for a single "Apply" button linking the original posting, so new cards carry no feedback buttons; the weights and handlers stay for cards already sent.
- [x] `/settings` (`s:` buttons): work format, employment, minimum salary, delivery mode (instant / scheduled), send times, quiet hours, timezone, minimum score, cap, sources on/off, language, pause.
- [x] One send limiter for all chats (≈30 msg/s overall, 1/s per chat); `403 blocked` turns the digest off (the chat is unlinked; `/start` resumes).

**Exit criterion:** a new user gets scored vacancies with an explanation and changes every setting without the website.

### 5.4 New sources (v1.29.0)

- [x] DOU.ua and Djinni RSS feeds by category / keyword. *(v1.29.0: 12 DOU categories, 14 Djinni keywords; one worker, `ingestion/ua-boards/`)*
- [x] **More Telegram channels** (the primary source, ADR-009; 7 channels today, all RU/IT and mostly frontend). Study TGStat: its free website catalog ("Работа и вакансии" category, search, similar channels) and whether its API has a free tier usable under ADR-001 (sign-up and a token are needed even for the non-billed methods). Also Telegram's own "similar channels", reposts in the channels already read, and public lists such as t-j.ru. Probe every candidate as `seed-data.ts` describes (reachable, posts often, vacancies not noise) and cover the stacks other bot users need, not only frontend. Hirify's catalogue is not a source: its terms forbid extracting its list of sources for another product (single channels seen while browsing are fine). *(v1.29.1: 7 → 17, Python, Node.js, Java, PHP, Android, DevOps and data besides frontend, Go and QA; resume posts from the groups are dropped; the prod `check` reports yield per channel. TGStat's website blocks non-browser clients, and its API needs a registered token and an activated plan, so neither is used; candidates came from the channels already read)*
- [x] SmartRecruiters, Recruitee, Personio public job APIs with a curated company list, like the Greenhouse/Ashby/Lever boards. *(v1.29.0: SmartRecruiters with ServiceNow, Experian, Freshworks, Canva. Recruitee and Personio probed: no company with remote engineering roles found, so no adapter yet; see DATA_SOURCES.md)*
- [x] Re-read each source's terms for redistribution to other people; disable the doubtful ones for non-owners with one setting. *(v1.29.0: `sources.config.ownerOnly`; set on LinkedIn alerts. The table is in DATA_SOURCES.md)*
- [ ] Optional: Adzuna / Jooble / Findwork (free key) after checking their limits and attribution rules.
- [x] LinkedIn alerts for everyone through a personal forwarding address (`alerts+<token>@…`), parsed by the recipient; still no request to linkedin.com (ADR-003, ADR-021). *(v1.29.2, ADR-027: `/linkedin` gives each user a plus address of the alerts mailbox; vacancies from a user's own alerts reach only that user (`vacancy_recipients`); the bot relays Gmail's forwarding confirmation code)*

**Exit criterion:** a senior frontend profile gets noticeably more matching vacancies a day than before (baseline measured in 5.3).

### 5.5 Applications and owner tools in the bot (v1.30.0)

- [x] "Applied" button on a card and `/applications`: list with stage buttons (applied → screening → interview → offer / rejected), follow-up reminders. *(v1.30.0: "✅ Откликнулся" next to "Откликнуться" on every card; `/applications` with an archive, a card per application with stage buttons; an hourly sweep reminds about applications with no answer, 10:00–20:00 local time; for every user)*
- [x] The author's web-only tools move into the bot (developer's decision, 2026-10-15, answering ADR-024 "Not decided here"): mock interview and per-topic questions as chat dialogs, the day planner's plan composition and close-out as commands next to its existing nudges, the kanban as the `/applications` list above. Owner-only (ADR-024 §3). *(v1.30.1: `/interview` (topic plan, questions with model answer and review, mock interview) and `/plan` (compose with the LLM, add blocks, start/pause/done/drop, close the day); `/help` lists them for the owner only)*

**Exit criterion:** nothing a job seeker or the author uses daily needs the website.

### 5.6 Release 2.0.0 (v2.0.0)

The developer asked on 2026-10-16 to keep the website for now and release everything else (ADR-028).

- [x] Public privacy policy at `/privacy` on the existing site (en/ru); the bot's `/privacy` links to it. *(The landing page waits for the website's removal.)*
- [x] Gmail connected from the bot: `/gmail` (owner) with the consent link and disconnect; Google's callback answers with a page pointing back to Telegram. The bot no longer links into the website ("Open in the app" buttons removed).
- [x] README, PRODUCT, ARCHITECTURE describe the bot-only product.
- [ ] *(Deferred, ADR-028)* `apps/web` reduced to a static landing page; email + password auth, sessions, web proxy and web-only API endpoints removed; CI drops the web suite. Needs the developer's word.
- [ ] Find 10–20 testers (developers the author knows, IT chats in Telegram).

**Exit criterion:** a stranger goes from `/start` to the first matching vacancy in 3 minutes without a website; 10 testers use it. Release 2.0.0.

### 5.7 Bot UX polish (v2.0.1) ✅

The developer's notes of 2026-10-15, to do once the current plan is done:

- [x] **Every command in the bot menu.** Register the command list with `setMyCommands` (per language, `ru` and `en`) so `/start`, `/settings`, `/help`, `/privacy` and the rest show in Telegram's menu button; today none are registered. A test keeps the menu in sync with the commands `BotService.registerCommand` knows. *(v2.0.1: published on every start; the owner's chat also lists /interview, /plan, /gmail)*
- [x] **Bigger `/settings` buttons with icons.** Telegram draws inline buttons as wide as their row, so the fix is fewer buttons per row (one or two instead of three) with an emoji icon per action (🕒 times, 🌍 timezone, 🔕 quiet hours, 💼 format, 💰 salary, 📡 sources, 🌐 language, ⏸ pause) and labels that fit without being cut. *(v2.0.1: two per row on the main menu and the sources screen)*
- [x] **Button texts say what they do.** The language button showed the other language's name ("English" / "Русский"); it now names the setting and its value, "🌐 Язык: Русский" / "🌐 Language: English", and the delivery-mode button reads "📬 Доставка: сразу". Reviewed the other buttons: the profile card's edit buttons get ✏️ ("✏️ Роль"); the rest already name an action.

**Exit criterion:** every command is reachable from the menu, and no `/settings` button text is cut or ambiguous on a phone.

### 5.8 Delivery without the LLM (v2.1.0) ✅

- [x] The owner's vacancies are scored by the formula like everyone else's: the stored candidate profile, or one built from the resume's terms (ADR-029).
- [x] The background LLM resume ↔ vacancy pass is removed; the LLM reads resumes and serves owner-only on-demand features.
- [x] "📥 Send vacancies now" in the bot (`/digest`, a button in `/settings`): the web cabinet's manual send, so vacancies missed by a push can be pulled from the chat (v2.2.0).

**Exit criterion:** no LLM outage or rate limit can empty a push.

### 5.9 Onboarding in the bot (v2.3.0) ✅

- [x] `/resume` and a `/settings` button: see, add or replace the resume from the chat.
- [x] `/setup`: a step-by-step checklist for a new user, a button per step.
- [x] The welcome, `/help` and stray-text replies say how to send a resume.
- [x] Owner-only `/testmode`: walk the new-user flow from the owner's own chat and come back without losing data.

**Exit criterion:** a new user can get from `/start` to the first vacancy without reading anything outside the bot.

### 5.10 Settings and filters apart (v2.4.0) ✅

- [x] `/settings` keeps delivery only (mode, times, quiet hours, timezone, per send, language, pause).
- [x] `/filters`: the resume profile's role, grade and skills, editable, plus minimum fit, format, employment, salary and sources.
- [x] `/setup` renamed "First steps" so the menu has one "Settings".

**Exit criterion:** every "which vacancies" choice is on `/filters`, every "when" choice on `/settings`.

### 5.11 Vacancy card and location filter (v2.5.0) ✅

- [x] Card as icon rows: date and time by the company, location and format lines, ✅ / 🟡 / ❌ skill rows, a coloured fit dot.
- [x] "Apply via <board>" on the button.
- [x] Location filter for on-site and hybrid vacancies in `/filters`.

**Exit criterion:** a card can be judged at a glance, and an on-site search gets only the cities asked for.

### 5.12 Stats, sources, error alerts and feedback (v2.6.0) ✅

- [x] Owner-only `/stats`: users (new, active, reachable), the sign-up funnel with shares, the week's deliveries, who left, errors and feedback.
- [x] Shared links with a source tag (`t.me/JobRadarAppBot?start=<tag>`), counted per tag in `/stats`.
- [x] Failures users hit go to the owner's chat (one alert per place and message per 30 minutes) and to `events`.
- [x] `/feedback`: a user's message goes to the owner's chat.

**Exit criterion:** the author sees how many people use the bot, where they stop, and what breaks, without opening the database.

### 5.13 Automated checks before testers (v2.6.1) ✅

- [x] End-to-end bot scenarios in CI: a tester's path from `/start` to vacancies, every menu command, `/feedback`, error alerts and `/delete`, with Telegram faked and its limits enforced (ADR-030).
- [x] Prod smoke twice a day: health and deployed version, the webhook, ingestion freshness, deliveries and errors (ADR-030).
- [x] *(Developer)* Add `TELEGRAM_BOT_TOKEN` to the `main - jobradar-api` environment secrets so the smoke run checks the webhook. *(2026-10-19; first run green)*
- [x] `/testmode` round trip fixed and covered by an end-to-end scenario (v2.6.2).

**Exit criterion:** a change that breaks a tester's path fails CI, and a broken production is reported within half a day.

### 5.14 Working language of a vacancy (v2.7.0) ✅

- [x] The language a vacancy is written in and the languages it requires, read from its text without the LLM (ADR-033).
- [x] A 🗣 row on the card.
- [x] `/filters` → 🗣 Languages: hide vacancies in other languages (English, Russian and Ukrainian by default).

**Exit criterion:** a vacancy written only in Spanish does not reach a user who works in English and Russian, and every card says what language the work is in.

### 5.15 Looking for work without a resume (v2.8.0) ✅

- [x] `/noresume`: role, grade, skills and English asked one by one; the answers become the candidate profile, no file and no LLM call (ADR-034).
- [x] "✍️ Without a resume" on `/resume` and `/setup`, a line in the `/start` welcome, `/privacy` says the resume is optional.
- [x] `/stats` counts profiles set by hand.

**Exit criterion:** a new user who never sends a file confirms a profile and receives matching vacancies.

### 5.16 Daily delivery quality audit (v2.9.0) ✅

- [x] `Quality audit` workflow: the author's funnel replayed over the last day's vacancies, a free LLM judge, the report in the run summary and Telegram (ADR-035).
- [x] Title words of the job families as data (`matching/dictionaries/`), a regression set, fixes opened as a pull request.

**Exit criterion:** every morning the author gets a summary of what was sent wrongly and what was missed, and title-word misses arrive as a tested PR.

### 5.17 Resume profile accuracy (v2.10.0) ✅

- [x] Analysis prompt v2: today's date, a stated "N+ years" taken as is, every language a skill of its own.
- [x] The resume text corrects the result: stated years, dictionary skills the model left out.
- [x] The card edits the years by hand; skills take `+Skill` / `-Skill`.

**Exit criterion:** a resume that says "8+ years" with JavaScript in its skills gets a profile with 8 years and JavaScript.

### 5.18 Backend-stack rule for frontend profiles (v2.11.0) ✅

- [x] A title naming a backend language the frontend profile lacks is capped; Node.js fullstack and the profile's own languages stay (ADR-036).

**Exit criterion:** "Full-stack Python Developer" is not delivered to a React profile without Python; "Fullstack React/Node.js" is.

### Later (not in 2.0.0)

- [ ] Telegram Mini App for settings and a filtered feed, only if chat dialogs prove too clumsy (ADR-024 §5).
- [ ] Monetization decision at roughly 100 active users: donations, one-off purchases or a subscription in Telegram Stars, or stay free. Billing code only after that decision.

## Timeline sanity check

Phases 0–3 ≈ 6–7 calendar weeks of part-time work to v1.0. If a phase overruns by more than 2×, cut scope inside the phase rather than extending it.
