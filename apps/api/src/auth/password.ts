import {
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

// promisify's overloads drop the optional `options` argument; retype it explicitly.
const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: ScryptOptions,
) => Promise<Buffer>;

// scrypt cost parameters. N=2^15 is a sane interactive-login cost; keyLen 64.
// maxmem must exceed 128*N*r bytes (~34 MB here); Node's default 32 MB is too low.
const KEY_LEN = 64;
const MAXMEM = 64 * 1024 * 1024;
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: MAXMEM } as const;

/**
 * Hashes a password with scrypt (Node stdlib — no native dependency, memory-hard).
 * Encoded as `scrypt$N$r$p$saltHex$hashHex` so parameters travel with the hash.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  // maxmem is a runtime guard, not a verification parameter — no need to store it.
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Verifies a password against a stored hash. Constant-time; false on any malformed input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(parts[4] ?? '', 'hex');
  const expected = Buffer.from(parts[5] ?? '', 'hex');
  if (expected.length === 0) return false;

  const derived = await scrypt(password, salt, expected.length, { N, r, p, maxmem: MAXMEM });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
