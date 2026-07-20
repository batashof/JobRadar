import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

// The NestJS API runs as a separate service (ADR-002). The browser talks to it
// only through this same-origin proxy, so the session cookie stays first-party
// (vercel.app and onrender.com are different registrable domains — a direct
// cross-site cookie would be dropped by modern browsers). This is routing, not
// backend logic, so ADR-002 holds.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/:path*`,
      },
    ];
  },
};

// Injects the Sentry instrumentation and, when SENTRY_AUTH_TOKEN/SENTRY_ORG/
// SENTRY_PROJECT are set at build time, uploads source maps for deminified
// stack traces. Without those it is a no-op wrapper, so local builds are
// unaffected (ADR-001). `silent` keeps the build log quiet outside CI.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  // Route browser error/session requests through the app to dodge ad blockers.
  tunnelRoute: '/monitoring',
  // Strip the Sentry SDK logger from the client bundle to keep it small.
  disableLogger: true,
});
