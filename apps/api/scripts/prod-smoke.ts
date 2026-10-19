/**
 * Production smoke check: is the bot up, reachable by Telegram, and are
 * vacancies still arriving and reaching people. Read-only. Runs from the
 * "Prod smoke" workflow twice a day; a failure turns the run red, which
 * GitHub mails to the author.
 *
 * Every input is optional except the API origin: a missing secret skips its
 * part with a notice instead of failing.
 *   API_ORIGIN           public API origin (default: the Render service)
 *   TELEGRAM_BOT_TOKEN   enables the webhook check (getWebhookInfo, read-only)
 *   DATABASE_URL_PROD    enables the pipeline check (+ DATABASE_CA_CERT_PROD)
 *
 * Usage: pnpm --filter @jobradar/api smoke:prod
 */
import { appendFileSync } from 'node:fs';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import type { HealthResponse } from '@jobradar/shared';

import { openScriptDb } from '../src/db/prod-db';
import {
  checkHealth,
  checkPipeline,
  checkWebhook,
  renderSmoke,
  type SmokeResult,
  type WebhookInfo,
} from '../src/health/smoke';

config({ path: '../../.env' });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../package.json') as { version: string };

const API_ORIGIN = (process.env.API_ORIGIN || 'https://jobradar-api-ptvp.onrender.com').replace(/\/+$/, '');

/** A sleeping Render free instance needs 30-60 s for its first answer. */
async function fetchHealth(): Promise<{ health: HealthResponse | null; error?: string }> {
  let error = 'no attempt';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${API_ORIGIN}/health`, { signal: AbortSignal.timeout(90_000) });
      if (response.ok) return { health: (await response.json()) as HealthResponse };
      error = `HTTP ${response.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  return { health: null, error };
}

async function webhookResults(now: Date): Promise<SmokeResult[]> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return [{ level: 'warn', check: 'webhook', detail: 'skipped: TELEGRAM_BOT_TOKEN secret is not set' }];
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json()) as { ok: boolean; result?: WebhookInfo; description?: string };
    if (!payload.ok || !payload.result) {
      return [{ level: 'fail', check: 'webhook', detail: `getWebhookInfo: ${payload.description ?? response.status}` }];
    }
    return checkWebhook(payload.result, API_ORIGIN, now);
  } catch (err) {
    // Never print the token: it is only in the URL, which is not logged.
    return [{ level: 'fail', check: 'webhook', detail: `getWebhookInfo: ${err instanceof Error ? err.message : String(err)}` }];
  }
}

async function pipelineResults(now: Date): Promise<SmokeResult[]> {
  if (!process.env.DATABASE_URL_PROD) {
    return [{ level: 'warn', check: 'pipeline', detail: 'skipped: DATABASE_URL_PROD secret is not set' }];
  }
  const { db, close } = openScriptDb(true);
  try {
    const { rows } = await db.execute<{
      newest: string | null;
      vacancies: number;
      deliveries: number;
      recipients: number;
      errors: number;
      top_where: string | null;
    }>(sql`
      select
        (select max(ingested_at) from vacancies)::text as newest,
        (select count(*) from vacancies where ingested_at > now() - interval '24 hours')::int as vacancies,
        (select count(*) from digest_items where sent_at > now() - interval '24 hours')::int as deliveries,
        (select count(*) from candidate_profiles p
           join telegram_accounts t on t.user_id = p.user_id
           where p.confirmed_at is not null and t.chat_id is not null)::int as recipients,
        (select count(*) from events where name = 'error' and created_at > now() - interval '24 hours')::int as errors,
        (select props ->> 'where' from events
           where name = 'error' and created_at > now() - interval '24 hours'
           group by 1 order by count(*) desc limit 1) as top_where`);
    const row = rows[0]!;
    return checkPipeline(
      {
        newestIngestedAt: row.newest ? new Date(row.newest) : null,
        vacancies24h: row.vacancies,
        deliveries24h: row.deliveries,
        activeRecipients: row.recipients,
        errors24h: row.errors,
        topErrorWhere: row.top_where,
      },
      now,
    );
  } catch (err) {
    return [{ level: 'fail', check: 'pipeline', detail: `query failed: ${err instanceof Error ? err.message : String(err)}` }];
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  const now = new Date();
  const { health, error } = await fetchHealth();
  const results = [
    ...checkHealth(health, version, error),
    ...(await webhookResults(now)),
    ...(await pipelineResults(now)),
  ];

  const table = renderSmoke(results);
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Prod smoke — ${API_ORIGIN}\n\n${table}\n`);
  }
  for (const result of results) {
    if (result.level === 'fail') console.log(`::error title=${result.check}::${result.detail}`);
    if (result.level === 'warn') console.log(`::warning title=${result.check}::${result.detail}`);
  }
  if (results.some((r) => r.level === 'fail')) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
