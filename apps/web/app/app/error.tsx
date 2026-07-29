'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

import { ErrorView } from '@/components/error-view';

/**
 * Boundary for the signed-in pages. Renders inside the app shell (the layout
 * survives), so a single failing page keeps the header and navigation.
 */
export default function AppError({
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
