/**
 * @jobradar/shared — types, validation schemas and constants shared
 * between apps/web and apps/api.
 */

export const APP_NAME = 'JobRadar';

/** Component diagnostics included in the health response. Never carries secrets. */
export interface HealthChecks {
  db: 'ok' | 'unreachable';
  redis: 'ok' | 'unreachable';
  /** Hostname (no credentials) the queue is configured against; null if REDIS_URL is invalid. */
  redisHost: string | null;
  /** Whether the redis connection uses TLS (rediss://). Managed Redis (Upstash) requires it. */
  redisTls: boolean;
  ingestionTokenConfigured: boolean;
}

/** Shape of the API health-check response (GET /health). */
export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  timestamp: string;
  checks?: HealthChecks;
}
