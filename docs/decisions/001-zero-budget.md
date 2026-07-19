# ADR-001: Zero-budget constraint — free tiers only

- Status: Accepted
- Date: 2026-07-19

## Context

JobRadar is a learning-first pet project with no revenue and no guarantee of external users. Recurring infrastructure costs create pressure to either abandon the project or monetize prematurely.

## Decision

Total infrastructure budget is **$0**. Every service must run on a free tier: Vercel (web), Railway/Fly.io (api), Neon/Supabase (Postgres), Upstash (Redis), Resend (email), Sentry (monitoring), GitHub Actions (CI + cron), free LLM tiers (phase 4). The single allowed expense is a domain (~$10/year), and it is optional.

## Consequences

- Easier: no financial pressure; the project can pause and resume freely.
- Harder: free tiers sleep containers (mitigated by ADR-006), cap DB size/rows, cap email volume (3000/mo on Resend is plenty for one user), and cap LLM tokens per day (mitigated by ADR-005).
- Accepted trade-off: occasional cold-start latency and the obligation to design around limits.
- Any PR introducing a paid dependency violates this ADR and must supersede it first.
