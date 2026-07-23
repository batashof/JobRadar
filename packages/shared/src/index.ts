/**
 * @jobradar/shared — types, validation schemas and constants shared
 * between apps/web and apps/api.
 */

export const APP_NAME = 'JobRadar';

export * from './applications';
export * from './auth';
export * from './interview';
export * from './matches';
export * from './outreach';
export * from './planner';
export * from './profiles';
export * from './reminders';
export * from './resumes';
export * from './seniority';
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
  /** Whether all three TELEGRAM_* env vars are present (not their values). */
  telegramConfigured: boolean;
  /** Whether SENTRY_DSN is set, i.e. error reporting is active. */
  sentryConfigured: boolean;
  /** Configured LLM providers in failover order (ADR-005); empty = LLM features off. */
  llmProviders: string[];
}

/** Shape of the API health-check response (GET /health). */
export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  timestamp: string;
  checks?: HealthChecks;
}
