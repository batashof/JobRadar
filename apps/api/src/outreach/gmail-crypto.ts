import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash } from 'node:crypto';

/**
 * Small crypto helpers for the Gmail integration (ADR-011), keyed off
 * GOOGLE_CLIENT_SECRET so no extra secret needs provisioning:
 * - refresh tokens are AES-256-GCM encrypted at rest;
 * - the OAuth `state` parameter is an HMAC-signed userId + expiry, because the
 *   Google callback hits the API origin directly where the session cookie
 *   (first-party to the web origin) is not available.
 */

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64')).join('.');
}

export function decryptToken(stored: string, secret: string): string | null {
  try {
    const [iv, tag, data] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
    if (!iv || !tag || !data) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const STATE_TTL_MS = 10 * 60 * 1000;

export function signState(userId: string, secret: string, now = Date.now()): string {
  const payload = `${userId}.${now + STATE_TTL_MS}`;
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${mac}`;
}

export function verifyState(state: string, secret: string, now = Date.now()): string | null {
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const payloadB64 = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (mac !== expected) return null;
  const sep = payload.lastIndexOf('.');
  const userId = payload.slice(0, sep);
  const expiry = Number(payload.slice(sep + 1));
  if (!userId || !Number.isFinite(expiry) || now > expiry) return null;
  return userId;
}
