import { generateSessionToken, sessionCookieOptions, SESSION_TTL_MS } from './session';

describe('session helpers', () => {
  it('generates unique, high-entropy url-safe tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes base64url ≈ 43 chars.
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it('builds httpOnly, lax cookie options with the given max age', () => {
    const opts = sessionCookieOptions(1000);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 1000 });
  });

  it('defaults max age to the session TTL', () => {
    expect(sessionCookieOptions().maxAge).toBe(SESSION_TTL_MS);
  });
});
