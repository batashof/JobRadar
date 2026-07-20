import * as Sentry from '@sentry/nestjs';

// Loaded before any other module (see main.ts) so Sentry can auto-instrument
// the frameworks it hooks into. No DSN → no-op: local dev, CI and tests run
// without touching Sentry, and the $0 budget is never at risk (ADR-001).
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    // Tracing is off by default to stay well inside the free tier; opt in per
    // environment with SENTRY_TRACES_SAMPLE_RATE (e.g. 0.1) when needed.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}

/** True when Sentry is active — used by /health diagnostics. */
export const sentryEnabled = Boolean(dsn);
