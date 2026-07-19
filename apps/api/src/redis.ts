import type { RedisOptions } from 'bullmq';

/**
 * Parses a redis:// / rediss:// URL into BullMQ connection options.
 * Defensive on purpose: env values pasted into hosting dashboards often carry
 * stray quotes/whitespace, and a throw here would crash the app at bootstrap.
 * Returns null for anything that is not a valid redis URL.
 * `maxRetriesPerRequest: null` is required by BullMQ workers.
 */
export function redisConnectionFromUrl(raw: string): RedisOptions | null {
  const cleaned = raw.trim().replace(/^["']+|["']+$/g, '');
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') return null;

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
