import type { RedisOptions } from 'bullmq';

/**
 * Parses a redis:// / rediss:// URL into BullMQ connection options.
 * `maxRetriesPerRequest: null` is required by BullMQ workers.
 */
export function redisConnectionFromUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
