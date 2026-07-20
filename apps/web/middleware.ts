import { SESSION_COOKIE_NAME } from '@jobradar/shared';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Cheap edge gate on session-cookie *presence* — real validation happens in the
 * API and the `/app` server layout (which redirects if the cookie is stale). We
 * only guard `/app` here; we deliberately do NOT bounce cookie-holders away from
 * the auth pages, so a stale cookie can't create a redirect loop with the layout.
 */
export function middleware(req: NextRequest): NextResponse {
  const hasSession = req.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSession && req.nextUrl.pathname.startsWith('/app')) {
    const url = new URL('/login', req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*'],
};
