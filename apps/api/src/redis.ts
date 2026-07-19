import type { RedisOptions } from 'bullmq';
import IORedis from 'ioredis';

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

  // Upstash only accepts TLS connections; a pasted redis:// URL is a common
  // dashboard mistake that would otherwise fail silently — force TLS for it.
  const needsTls = parsed.protocol === 'rediss:' || parsed.hostname.endsWith('.upstash.io');

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    ...(needsTls ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

export type RedisProbeResult = { ok: true } | { ok: false; error: string };

/**
 * One-shot reachability probe with short timeouts and no retries, so the real
 * failure (WRONGPASS, ETIMEDOUT, ENOTFOUND, ...) surfaces instead of queueing
 * forever like the BullMQ connection does. Error text never contains secrets.
 */
export async function probeRedis(options: RedisOptions): Promise<RedisProbeResult> {
  const client = new IORedis({
    ...options,
    maxRetriesPerRequest: 0,
    connectTimeout: 4000,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  // With retryStrategy=null, connect() rejects with a generic "Connection is
  // closed." while the real cause (ECONNREFUSED, WRONGPASS, TLS failure, ...)
  // is only emitted as an 'error' event — capture the first one.
  let firstError: Error | undefined;
  client.on('error', (error) => {
    firstError ??= error;
  });
  try {
    await client.connect();
    await client.ping();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (firstError ?? (error as Error)).message.slice(0, 160) };
  } finally {
    client.disconnect();
  }
}
