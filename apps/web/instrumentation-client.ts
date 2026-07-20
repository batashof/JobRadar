import * as Sentry from '@sentry/nextjs';

// Browser runtime. NEXT_PUBLIC_ so the DSN is inlined into the client bundle;
// no DSN → no-op.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}

// Enables reporting of navigation spans (App Router) even when tracing is off.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
