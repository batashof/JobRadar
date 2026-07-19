# ADR-007: API hosting on Render free tier

- Status: Accepted
- Date: 2026-07-19

## Context

ARCHITECTURE.md originally planned Railway or Fly.io for the NestJS API. As of mid-2026 neither fits ADR-001 (zero budget):

- **Railway** removed its free tier; new accounts get a one-time $5 trial credit, then the Hobby plan costs $5/mo.
- **Fly.io** no longer offers a free tier to new users and requires a credit card.

Remaining genuinely free options for a Docker container: **Render** (free web services that spin down after 15 min of inactivity, 30–60 s cold start) and **Koyeb** (free nano instances).

## Decision

Deploy the API as a Docker web service on **Render's free tier**, defined via `render.yaml` blueprint in the repo (build from `apps/api/Dockerfile`, health check on `/health`).

Render over Koyeb: larger ecosystem/docs, blueprint IaC support, and a straightforward upgrade path if the project ever outgrows the free tier.

## Consequences

- $0 hosting preserved; deployment is reproducible from `render.yaml`.
- The service sleeps after 15 minutes of inactivity. This was already anticipated by ADR-006: the GitHub Actions cron wakes the service via the authenticated ingestion hook, so scheduled ingestion is unaffected. Interactive first-hit latency (cold start) is acceptable for a single-user v1.
- BullMQ workers only run while the service is awake — fine for cron-triggered jobs; anything requiring an always-on worker would need a paid plan or a different host (new ADR).
- If Render's free tier terms change, revisit with Koyeb as the fallback (new ADR).
