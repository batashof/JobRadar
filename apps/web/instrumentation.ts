import * as Sentry from '@sentry/nextjs';

// Next.js calls register() once per server runtime. Load the matching Sentry
// config so Node and Edge each initialize with their own SDK build.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Reports errors thrown while rendering Server Components / route handlers.
export const onRequestError = Sentry.captureRequestError;
