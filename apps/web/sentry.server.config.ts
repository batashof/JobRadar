import * as Sentry from '@sentry/nextjs';

// Node.js runtime (Server Components, route handlers, server actions).
// No DSN → no-op, so local dev, CI and tests never touch Sentry (ADR-001).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}
