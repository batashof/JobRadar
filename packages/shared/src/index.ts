/**
 * @jobradar/shared — types, validation schemas and constants shared
 * between apps/web and apps/api.
 */

export const APP_NAME = 'JobRadar';

export * from './applications';
export * from './auth';
export * from './profiles';
export * from './vacancies';

/** Component diagnostics included in the health response. Never carries secrets. */
export interface HealthChecks {
  db: 'ok' | 'unreachable';
  redis: 'ok' | 'unreachable';
  /** Hostname (no credentials) the queue is configured against; null if REDIS_URL is invalid. */
  redisHost: string | null;
  redisPort: number | null;
  /** Whether the redis connection uses TLS (rediss://). Managed Redis (Upstash) requires it. */
  redisTls: boolean;
  /** Connection failure detail (no secrets); null when redis is ok. */
  redisError: string | null;
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
