# ADR-006: External cron via GitHub Actions schedule

- Status: Accepted
- Date: 2026-07-19

## Context

Ingestion must run every ~4 hours. Free hosting tiers (Railway/Fly.io) sleep idle containers, so in-process schedulers (node-cron, BullMQ repeatable jobs) silently stop when the container sleeps. A paid always-on instance violates ADR-001.

## Decision

Scheduling lives **outside** the application: a GitHub Actions workflow with `on: schedule` (every 4 hours) calls an authenticated hook `POST /ingestion/run` on the API. The call wakes a sleeping container, doubles as a keep-alive/health signal, and the run's HTTP status is visible in the Actions history for free.

The hook requires a shared secret token (GitHub Actions secret ↔ API env var). BullMQ still handles in-process job orchestration once a run is triggered.

## Consequences

- Easier: free, reliable, observable scheduling; no dependency on container uptime.
- Harder: GitHub Actions schedule has jitter (runs may start minutes late; occasionally skipped under load) — irrelevant at a 4-hour cadence.
- Accepted trade-off: scheduling config lives in the repo's workflow file rather than in application code.
