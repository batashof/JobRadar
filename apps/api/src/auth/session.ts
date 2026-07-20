import { randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';

/** Name of the httpOnly cookie carrying the opaque session token. */
export const SESSION_COOKIE = 'jr_session';

/** Session lifetime: 30 days. Refreshed implicitly by re-login. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Generates a high-entropy opaque session token (256 bits, url-safe). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Cookie options for the session. Cross-site is avoided by proxying `/api` through
 * the web app (Next rewrites), so the cookie stays first-party and `sameSite: lax`
 * is enough. `secure` is on outside local dev.
 */
export function sessionCookieOptions(maxAgeMs: number = SESSION_TTL_MS): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeMs,
  };
}
