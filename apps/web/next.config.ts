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

export default nextConfig;
