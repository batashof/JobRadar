# Architecture Decision Records

Numbered, immutable records of significant decisions. To change a decision, add a new ADR that supersedes the old one — do not edit accepted ADRs.

## Index

| # | Title | Status |
|---|---|---|
| [001](001-zero-budget.md) | Zero-budget constraint: free tiers only | Accepted |
| [002](002-separate-backend.md) | Backend as a separate service | Accepted |
| [003](003-no-linkedin-scraping.md) | No LinkedIn scraping | Accepted (amended by ADR-021) |
| [004](004-dedup-heuristic-first.md) | Deduplication: heuristic first, LLM later | Accepted |
| [005](005-llm-free-tier-failover.md) | LLM via free tiers with provider failover | Accepted |
| [006](006-github-actions-cron.md) | External cron via GitHub Actions | Accepted |
| [007](007-api-hosting-render.md) | API hosting on Render free tier | Accepted |
| [008](008-orm-drizzle.md) | ORM — Drizzle | Accepted |
| [009](009-drop-hh-telegram-primary.md) | Drop hh.ru; Telegram job channels as the primary source | Accepted |
| [010](010-sentry-error-monitoring.md) | Sentry for error monitoring on both apps | Accepted |
| [011](011-resume-apply-assistant.md) | Resume-driven apply assistant (upload, LLM matching, cover letters, Gmail apply) | Accepted (amended by ADR-029) |
| [012](012-feed-resume-relevance.md) | Feed-centric resume-driven relevance (remove Matches page, on-demand fit gauge, soft seniority filter) | Accepted |
| [013](013-interview-prep-module.md) | Interview-prep module (resume-driven plan, generated Q&A, LLM-reviewed live-coding, text mock interview) | Accepted |
| [014](014-interface-language-i18n.md) | Two-language interface (EN/RU) driving UI and AI generation | Accepted |
| [015](015-day-planner-accountability.md) | Day planner with accountability loop (LLM-composed timebox queue, Telegram nudges, rolling debt) | Accepted |
| [016](016-board-quality-gate.md) | Board quality gate: shared description sanitizer, RemoteOK dropped, Himalayas added | Accepted |
| [017](017-resume-lexical-prerank.md) | Résumé-lexical pre-ranking as the always-present relevance signal | Accepted |
| [018](018-vacancy-seniority-from-title.md) | A vacancy's seniority comes from its title, not from its prose (amends ADR-012 §3) | Accepted |
| [019](019-postgres-on-supabase.md) | Production Postgres moves from Neon to Supabase (compute-hour quota exhausted by the always-on API) | Accepted |
| [020](020-instant-digest-delivery.md) | Instant digest delivery — push new matches after each ingestion, not only on a schedule | Accepted (amended by ADR-022) |
| [021](021-linkedin-job-alert-emails.md) | LinkedIn vacancies from job-alert emails read over IMAP — no request to linkedin.com (amends ADR-003) | Accepted (amended by ADR-027) |
| [022](022-digest-sends-every-new-vacancy.md) | The digest sends every new vacancy since the previous send, not a top ten (amends ADR-020) | Accepted |
| [023](023-ten-minute-ingestion-tick.md) | A 10-minute ingestion tick fired by Supabase pg_cron, with per-source intervals (amends ADR-006, ADR-020 §3) | Accepted |
| [024](024-telegram-only-product.md) | JobRadar becomes a Telegram-bot product for other job seekers; the web app is retired in 2.0.0 (amends ADR-002, 014, 015, 020) | Accepted (amended by ADR-028, ADR-029) |
| [025](025-llm-only-at-registration.md) | The LLM reads the resume once at registration; vacancies are scored by a deterministic formula (amends ADR-005, 011, 012, 020, 022 for non-owners) | Accepted (amended by ADR-026, ADR-029) |
| [026](026-formula-gate-precision.md) | The formula's quality gate measures precision against the LLM, not top-20 overlap (amends ADR-025 §9) | Accepted |
| [027](027-linkedin-forwarding-addresses.md) | Every bot user forwards their own LinkedIn job alerts to a personal plus address (amends ADR-021) | Accepted |
| [028](028-web-app-kept-as-owner-cabinet.md) | 2.0.0 ships with the web app kept as the author's cabinet; public `/privacy`, `/gmail` in the bot (amends ADR-024) | Accepted |
| [029](029-formula-for-the-owner-too.md) | The owner's vacancies are scored by the formula too; the LLM reads resumes only (amends ADR-011, ADR-024 §3, ADR-025 §8) | Accepted |
| [030](030-bot-e2e-and-prod-smoke.md) | End-to-end bot scenarios in CI and a twice-daily production smoke check | Accepted |
| [031](031-in-process-ingestion-queue.md) | The ingestion queue runs in process; Redis and BullMQ removed (Upstash command quota; amends ADR-001, ADR-006, ADR-007, ADR-030) | Accepted |

## Template

```markdown
# ADR-NNN: Title

- Status: Proposed | Accepted | Superseded by ADR-MMM
- Date: YYYY-MM-DD

## Context
What situation forces a decision.

## Decision
What we decided.

## Consequences
What becomes easier, what becomes harder, what we accept as a trade-off.
```
