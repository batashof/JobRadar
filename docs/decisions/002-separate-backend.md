# ADR-002: Backend as a separate service (not Next.js API routes)

- Status: Accepted
- Date: 2026-07-19

## Context

The author is a frontend developer (React, 8 years) whose primary goal for this project is real full-stack experience. Next.js API routes would be the path of least resistance, but they hide exactly the parts the author wants to learn: service structure, DI, migrations, queues, long-running workers, Docker, independent deployment.

Additionally, the domain genuinely needs long-running background workers (ingestion, dedup, digest) — a poor fit for serverless API routes with execution time limits.

## Decision

The backend is a standalone NestJS + TypeScript service in `apps/api`, deployed separately (Railway/Fly.io) from the Next.js frontend (Vercel). BullMQ workers run inside the API service process. The frontend talks to the backend over a REST/JSON API only. Fastify remains the fallback if NestJS proves too heavyweight.

## Consequences

- Easier: real backend learning; workers run without serverless time limits; the API can serve future clients (Telegram bot, browser extension) uniformly.
- Harder: two deployments, CORS, shared types need `packages/shared`, free-tier container sleeping (mitigated by ADR-006).
- Accepted trade-off: more moving parts than a single Next.js app — that complexity is the point.
