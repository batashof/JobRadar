import type { HealthResponse } from '@jobradar/shared';

/**
 * Verdicts of the production smoke check (`scripts/prod-smoke.ts`, run by the
 * "Prod smoke" workflow). Pure functions over what the script fetched, so the
 * thresholds are unit-tested; the script only does the IO.
 *
 * `fail` turns the workflow red, which GitHub mails to the author; `warn` is
 * printed in the run summary only.
 */
export type SmokeLevel = 'ok' | 'warn' | 'fail';

export interface SmokeResult {
  level: SmokeLevel;
  check: string;
  detail: string;
}

/** Newest vacancy older than this means ingestion has stopped (ticks run every 10 minutes, ADR-023). */
export const INGESTION_STALE_HOURS = 6;
/** A webhook delivery error newer than this means users are not being answered now. */
export const WEBHOOK_ERROR_RECENT_MINUTES = 60;
/** Updates queued at Telegram beyond this mean the API is not taking them. */
export const WEBHOOK_PENDING_MAX = 20;

const ok = (check: string, detail: string): SmokeResult => ({ level: 'ok', check, detail });
const warn = (check: string, detail: string): SmokeResult => ({ level: 'warn', check, detail });
const fail = (check: string, detail: string): SmokeResult => ({ level: 'fail', check, detail });

/** `GET /health`: reachable, its dependencies up, the bot on, and running the code on `main`. */
export function checkHealth(
  health: HealthResponse | null,
  expectedVersion: string,
  error?: string,
): SmokeResult[] {
  if (!health) return [fail('health', `GET /health failed: ${error ?? 'no response'}`)];
  const checks = health.checks;
  const results: SmokeResult[] = [
    health.status === 'ok' ? ok('health', 'GET /health answered') : fail('health', `status ${String(health.status)}`),
    checks?.db === 'ok' ? ok('database', 'reachable') : fail('database', checks?.dbError ?? 'unreachable'),
    checks?.botConfigured
      ? ok('bot token', 'TELEGRAM_BOT_TOKEN is set')
      : fail('bot token', 'TELEGRAM_BOT_TOKEN is not set on Render: the bot is off'),
    health.version === expectedVersion
      ? ok('version', `${health.version} deployed`)
      : fail('version', `prod runs ${health.version}, main is ${expectedVersion}: the last deploy did not go out`),
  ];
  if (checks && checks.llmProviders.length === 0) {
    results.push(warn('llm', 'no LLM key: resumes get the rule-based fallback profile'));
  }
  if (checks && !checks.sentryConfigured) {
    results.push(warn('sentry', 'SENTRY_DSN is not set'));
  }
  return results;
}

/** Telegram's `getWebhookInfo` result, narrowed to what the check reads. */
export interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

/** The webhook points at this API, Telegram reaches it, and nothing piles up. */
export function checkWebhook(info: WebhookInfo, apiOrigin: string, now: Date): SmokeResult[] {
  const expected = `${apiOrigin.replace(/\/+$/, '')}/bot/telegram/webhook`;
  const results: SmokeResult[] = [
    info.url === expected
      ? ok('webhook url', expected)
      : fail('webhook url', `Telegram delivers to "${info.url || '(none)'}", expected ${expected}`),
    info.pending_update_count <= WEBHOOK_PENDING_MAX
      ? ok('webhook queue', `${info.pending_update_count} pending update(s)`)
      : fail('webhook queue', `${info.pending_update_count} updates waiting at Telegram: the API is not taking them`),
  ];
  if (info.last_error_date) {
    const minutes = Math.round((now.getTime() - info.last_error_date * 1000) / 60_000);
    const message = `${info.last_error_message ?? 'unknown error'} (${minutes} min ago)`;
    results.push(
      minutes <= WEBHOOK_ERROR_RECENT_MINUTES
        ? fail('webhook errors', message)
        : warn('webhook errors', `last delivery error: ${message}`),
    );
  }
  return results;
}

/** Counts the script reads from the production database. */
export interface PipelineStats {
  newestIngestedAt: Date | null;
  vacancies24h: number;
  deliveries24h: number;
  /** Linked chats that get vacancies: a confirmed profile, or the owner (ADR-029). */
  activeRecipients: number;
  errors24h: number;
  /** The most frequent `events.props.where` of the day's errors, if any. */
  topErrorWhere: string | null;
}

/** Vacancies keep arriving and reach people; the day's errors are surfaced. */
export function checkPipeline(stats: PipelineStats, now: Date): SmokeResult[] {
  const results: SmokeResult[] = [];
  if (!stats.newestIngestedAt) {
    results.push(fail('ingestion', 'no vacancies at all'));
  } else {
    const hours = (now.getTime() - stats.newestIngestedAt.getTime()) / 3_600_000;
    results.push(
      hours <= INGESTION_STALE_HOURS
        ? ok('ingestion', `${stats.vacancies24h} vacancies in 24 h, newest ${hours.toFixed(1)} h ago`)
        : fail('ingestion', `newest vacancy is ${hours.toFixed(1)} h old: ingestion has stopped`),
    );
  }

  // Few users and a strict filter can legitimately mean a quiet day, so no
  // deliveries is a warning, not a failure.
  results.push(
    stats.deliveries24h > 0 || stats.activeRecipients === 0
      ? ok('delivery', `${stats.deliveries24h} vacancies sent to ${stats.activeRecipients} recipient(s) in 24 h`)
      : warn('delivery', `nothing sent in 24 h to ${stats.activeRecipients} recipient(s) with a confirmed profile`),
  );

  results.push(
    stats.errors24h === 0
      ? ok('errors', 'no bot errors in 24 h')
      : warn('errors', `${stats.errors24h} bot error(s) in 24 h, most often at ${stats.topErrorWhere ?? 'unknown'}`),
  );
  return results;
}

/** Markdown table for the run summary; failures first. */
export function renderSmoke(results: SmokeResult[]): string {
  const order: Record<SmokeLevel, number> = { fail: 0, warn: 1, ok: 2 };
  const icon: Record<SmokeLevel, string> = { fail: '❌', warn: '⚠️', ok: '✅' };
  const rows = [...results]
    .sort((a, b) => order[a.level] - order[b.level])
    .map((r) => `| ${icon[r.level]} | ${r.check} | ${r.detail.replace(/\|/g, '\\|')} |`);
  return ['| | Check | Detail |', '|---|---|---|', ...rows].join('\n');
}
