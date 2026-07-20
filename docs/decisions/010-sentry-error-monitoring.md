# ADR-010: Sentry for error monitoring on both apps

- Status: Accepted
- Date: 2026-07-20

## Context

The v1.0 release checklist (ROADMAP phase 3) calls for error monitoring on both
apps. Until now a failure surfaced only in Render/Vercel logs — fine to read
after the fact, useless as an alert. A cron ingestion run that starts throwing,
or a Server Component that errors in production, should be visible without
tailing logs.

Constraints: ADR-001 (zero budget) and ADR-002 (the API is a separate NestJS
service, not Next.js routes), so each app needs its own instrumentation.

## Decision

Use **Sentry** on both apps via its official SDKs:

- **apps/api** — `@sentry/nestjs`. `instrument.ts` runs before any other import
  in `main.ts`; `SentryModule.forRoot()` + a global `SentryGlobalFilter` capture
  HTTP handler errors. BullMQ jobs run outside the request lifecycle, so the
  ingestion processor calls `Sentry.captureException` in its failure path
  (tagged with the source slug).
- **apps/web** — `@sentry/nextjs`. `instrumentation.ts` loads the Node/Edge
  configs, `instrumentation-client.ts` covers the browser, and `next.config.ts`
  is wrapped with `withSentryConfig`.

Sentry's free **Developer plan** (single user, 5k errors/mo) fits ADR-001.

Everything is gated on a DSN env var (`SENTRY_DSN` for the API,
`NEXT_PUBLIC_SENTRY_DSN` for the web app): **unset → the SDK is a no-op**, so
local dev, CI and tests never talk to Sentry and cost stays at $0. Tracing is
off by default (`SENTRY_TRACES_SAMPLE_RATE=0`) to protect the quota; opt in per
environment. Source-map upload is likewise opt-in via build-time
`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN`.

## Consequences

- Unhandled errors in either app reach a dashboard with alerting, at no cost.
- The `/health` response gains a presence-only `sentryConfigured` flag, matching
  the existing `telegramConfigured`/`ingestionTokenConfigured` diagnostics — lets
  us confirm the Render secret took without dashboard access.
- The DSN must be set as an env var on Render (API) and Vercel (web) for
  reporting to activate; a missing DSN degrades silently to no monitoring rather
  than breaking the app.
- Free-plan quota (5k errors/mo, 30-day retention) is ample for a single-user
  app; if the project ever grows past it, revisit (new ADR) rather than paying.
- Adds `@sentry/cli` (build-time source-map upload) to the allowed pnpm build
  scripts; it is a no-op without an auth token.
