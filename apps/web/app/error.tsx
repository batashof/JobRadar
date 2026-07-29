'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

import { ErrorView } from '@/components/error-view';

/**
 * Root-segment boundary. Catches anything below the root layout — including a
 * failing `/app` layout, which is where an API outage surfaces first (the
 * layout resolves the session before any page runs). Without this, a hung API
 * left the Vercel function to time out and serve a raw 504 page.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <ErrorView reset={reset} />;
}
