/**
 * @jobradar/shared — types, validation schemas and constants shared
 * between apps/web and apps/api.
 */

export const APP_NAME = 'JobRadar';

export * from './applications';
export * from './auth';
export * from './bot';
export * from './digest';
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
  /** Whether `TELEGRAM_BOT_TOKEN` is set, i.e. the bot channel can send. */
  botConfigured: boolean;
  /** Whether SENTRY_DSN is set, i.e. error reporting is active. */
  sentryConfigured: boolean;
  /** Configured LLM providers in failover order (ADR-005); empty = LLM features off. */
  llmProviders: string[];
  /**
   * How each configured provider's last call went, in failover order. A failing
   * chain is invisible from the outside — callers degrade rather than error —
   * so this is the only way to tell "the LLM is working" from "everything has
   * been falling back for days".
   */
  llmStatus: LlmProviderHealth[];
}

/** One provider's live state, as reported by GET /health. */
export interface LlmProviderHealth {
  name: string;
  /** The model this provider is configured to call (from env, or the default). */
  model: string;
  /** null until this process has called the provider at least once. */
  lastOutcome: 'ok' | 'failed' | null;
  /** Truncated failure detail, no keys or prompts; null when the last call was ok. */
  lastError: string | null;
  /** ISO timestamp of that last call. */
  lastAt: string | null;
}

/** Shape of the API health-check response (GET /health). */
export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  timestamp: string;
  checks?: HealthChecks;
}
