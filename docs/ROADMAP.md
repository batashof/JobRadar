# Roadmap

> **Current phase: 4 — Extensions (apply assistant first, ADR-011).** v1.0 released 2026-07-20.
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
- [ ] Telegram bot channel: `TELEGRAM_BOT_TOKEN` outbound `sendMessage` + `POST /planner/telegram/webhook` (secret-token guarded), inline *Start / Done / +15 min / Skip*. *(in-app delivery + `GET /planner/nudges` + ack shipped in v1.10.0; the bot plugs into the same `planner_nudges` rows once a token exists)*
- [ ] Planner stats on the dashboard: completion rate, debt (count + minutes), per-category time vs targets, estimation factor.

### Other extensions

- [ ] LLM relevance scoring + description summarization (free tiers, failover — ADR-005).
- [ ] Telegram bot as second digest channel. *(The bot itself arrives with the day planner, ADR-015; only the digest payload remains.)*
- [ ] Browser extension: one-click "Save to JobRadar" (covers LinkedIn/Djinni manually).
- [x] More sources: **Remotive, Jobicy, Working Nomads** (free no-auth JSON feeds, 2026-07-21). *(Telegram channels promoted to a v1.0 primary source — ADR-009.)* Still open: HN Who's Hiring, Djinni.
- [x] Funnel statistics: applied → screening → interview → offer conversion. *(`furthest_stage` column tracks the deepest non-terminal stage each application ever reached, so rejected/withdrawn cards still count through their peak; `GET /applications/stats` + dashboard Funnel card with per-step conversion — E2E verified)*
- [ ] Google Calendar sync for interviews (OAuth).

## Phase 5 — Hypothetical monetization (only if real external users appear)

- [ ] Multi-tenancy review, per-plan limits.
- [ ] Stripe in test mode (subscriptions, webhooks) — as a learning integration.
- [ ] Landing page, onboarding.

## Timeline sanity check

Phases 0–3 ≈ 6–7 calendar weeks of part-time work to v1.0. If a phase overruns by more than 2×, cut scope inside the phase rather than extending it.
