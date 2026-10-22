# ADR-030: End-to-end bot scenarios in CI and a twice-daily production smoke check

- Status: Accepted (amended by ADR-031: Redis is gone from the harness, CI and the smoke check)
- Date: 2026-10-19

## Context

Before the bot goes to testers, the developer asked for automated tests that run on their own. The 1,200 unit tests mock the database and Telegram per module, so nothing checked that the modules work together: that `/start`, a resume upload, the profile card, `/digest` and the instant push reach a user as Telegram would accept them. A message Telegram rejects (broken HTML, over 4,096 characters, a 65-byte button) is only a warning in the API log, so the user just sees nothing. In production, nothing checked on a schedule that the webhook still points at the API, that ingestion still runs, or that the deployed version is the one on `main`.

## Decision

1. **End-to-end scenarios** live in `apps/api/test/e2e` and run with `pnpm --filter @jobradar/api test:e2e` (a separate Jest config, so `pnpm test` stays fast and needs no services). They boot the whole `AppModule` against real Postgres and Redis and post Telegram updates to the webhook over HTTP. `FakeTelegram` replaces `fetch` for `api.telegram.org` only, records every Bot API call and refuses what the real API refuses (HTML parse errors, text over 4,096 visible characters, `callback_data` over 64 bytes, buttons with no or two actions); every test asserts there were no refusals. No LLM key is set, so resume analysis takes the rule-based fallback; LLM-per-action features stay out of scope (owner-only, ADR-024 §3).
2. **CI** gets a second job, "Bot end-to-end scenarios", with Postgres and Redis as GitHub Actions service containers. No secrets. The harness refuses any database that is not on this machine, since it truncates every table.
3. **Prod smoke** (`.github/workflows/prod-smoke.yml`, 05:30 and 17:30 UTC, and on demand) runs `scripts/prod-smoke.ts`, read-only: `GET /health` (database, Redis, bot token, deployed version equals `main`), Telegram `getWebhookInfo` (URL, pending updates, recent delivery errors) and the database (newest vacancy under 6 h old, deliveries and bot errors in 24 h). A failure turns the run red, which GitHub mails to the author; a missing secret skips its part with a warning.

## Consequences

- A change that breaks a tester's path, or produces a message Telegram would drop, fails CI before merge.
- CI time grows by about a minute (a parallel job); still within the free Actions allowance (ADR-001): two smoke runs a day of about a minute each.
- The scenarios cover the formula path only; a broken LLM prompt is still caught by unit tests and `formula:check`, not here.
- The webhook check needs `TELEGRAM_BOT_TOKEN` in the `main - jobradar-api` environment secrets; without it the smoke run only warns.
