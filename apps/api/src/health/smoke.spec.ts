import type { HealthResponse } from '@jobradar/shared';

import {
  checkHealth,
  checkPipeline,
  checkWebhook,
  INGESTION_STALE_HOURS,
  type PipelineStats,
  renderSmoke,
  WEBHOOK_PENDING_MAX,
} from './smoke';

const NOW = new Date('2026-10-19T12:00:00Z');
const API = 'https://jobradar-api-ptvp.onrender.com';

function health(overrides: Partial<NonNullable<HealthResponse['checks']>> = {}, version = '2.6.1'): HealthResponse {
  return {
    status: 'ok',
    service: 'jobradar-api',
    version,
    timestamp: NOW.toISOString(),
    checks: {
      db: 'ok',
      dbHost: 'db',
      dbCaConfigured: true,
      dbError: null,
      ingestionTokenConfigured: true,
      telegramConfigured: true,
      linkedinAlertsConfigured: true,
      botConfigured: true,
      sentryConfigured: true,
      llmProviders: ['groq'],
      llmStatus: [],
      ...overrides,
    } as NonNullable<HealthResponse['checks']>,
  };
}

const levels = (results: { level: string; check: string }[]) =>
  Object.fromEntries(results.map((r) => [r.check, r.level]));

describe('checkHealth', () => {
  it('passes a healthy instance running the expected version', () => {
    expect(checkHealth(health(), '2.6.1').every((r) => r.level === 'ok')).toBe(true);
  });

  it('fails when /health did not answer', () => {
    expect(checkHealth(null, '2.6.1', 'timeout')).toEqual([
      { level: 'fail', check: 'health', detail: 'GET /health failed: timeout' },
    ]);
  });

  it('fails on a down dependency, a missing bot token and a stale deploy', () => {
    const results = checkHealth(
      health({ db: 'unreachable', dbError: 'ETIMEDOUT', botConfigured: false }, '2.6.0'),
      '2.6.1',
    );
    expect(levels(results)).toMatchObject({ database: 'fail', 'bot token': 'fail', version: 'fail' });
    expect(results.find((r) => r.check === 'database')?.detail).toBe('ETIMEDOUT');
  });

  it('only warns about a missing LLM key or Sentry DSN', () => {
    const results = checkHealth(health({ llmProviders: [], sentryConfigured: false }), '2.6.1');
    expect(levels(results)).toMatchObject({ llm: 'warn', sentry: 'warn' });
    expect(results.some((r) => r.level === 'fail')).toBe(false);
  });
});

describe('checkWebhook', () => {
  const good = { url: `${API}/bot/telegram/webhook`, pending_update_count: 0 };

  it('passes a webhook on this API with an empty queue', () => {
    expect(checkWebhook(good, `${API}/`, NOW).every((r) => r.level === 'ok')).toBe(true);
  });

  it('fails when Telegram delivers elsewhere or nowhere', () => {
    expect(levels(checkWebhook({ ...good, url: '' }, API, NOW))['webhook url']).toBe('fail');
  });

  it('fails on a piled-up queue', () => {
    const results = checkWebhook({ ...good, pending_update_count: WEBHOOK_PENDING_MAX + 1 }, API, NOW);
    expect(levels(results)['webhook queue']).toBe('fail');
  });

  it('fails on a recent delivery error and warns on an old one', () => {
    const at = (minutesAgo: number) => Math.floor(NOW.getTime() / 1000) - minutesAgo * 60;
    const recent = checkWebhook({ ...good, last_error_date: at(5), last_error_message: 'Wrong response from the webhook: 502 Bad Gateway' }, API, NOW);
    expect(recent.find((r) => r.check === 'webhook errors')).toMatchObject({
      level: 'fail',
      detail: 'Wrong response from the webhook: 502 Bad Gateway (5 min ago)',
    });
    const old = checkWebhook({ ...good, last_error_date: at(600) }, API, NOW);
    expect(levels(old)['webhook errors']).toBe('warn');
  });
});

describe('checkPipeline', () => {
  const stats = (overrides: Partial<PipelineStats> = {}): PipelineStats => ({
    newestIngestedAt: new Date(NOW.getTime() - 30 * 60_000),
    vacancies24h: 120,
    deliveries24h: 14,
    activeRecipients: 3,
    errors24h: 0,
    topErrorWhere: null,
    ...overrides,
  });

  it('passes fresh vacancies that reach people', () => {
    expect(checkPipeline(stats(), NOW).every((r) => r.level === 'ok')).toBe(true);
  });

  it('fails when ingestion stopped', () => {
    const stale = new Date(NOW.getTime() - (INGESTION_STALE_HOURS + 1) * 3_600_000);
    expect(levels(checkPipeline(stats({ newestIngestedAt: stale }), NOW)).ingestion).toBe('fail');
    expect(levels(checkPipeline(stats({ newestIngestedAt: null }), NOW)).ingestion).toBe('fail');
  });

  it('warns when nothing reached recipients, but not when there are none', () => {
    expect(levels(checkPipeline(stats({ deliveries24h: 0 }), NOW)).delivery).toBe('warn');
    expect(levels(checkPipeline(stats({ deliveries24h: 0, activeRecipients: 0 }), NOW)).delivery).toBe('ok');
  });

  it('warns with the most frequent place of the day\'s errors', () => {
    const errors = checkPipeline(stats({ errors24h: 3, topErrorWhere: 'resume upload' }), NOW);
    expect(errors.find((r) => r.check === 'errors')).toMatchObject({
      level: 'warn',
      detail: '3 bot error(s) in 24 h, most often at resume upload',
    });
  });
});

describe('renderSmoke', () => {
  it('lists failures first and escapes table pipes', () => {
    const table = renderSmoke([
      { level: 'ok', check: 'a', detail: 'fine' },
      { level: 'fail', check: 'b', detail: 'x | y' },
    ]);
    const lines = table.split('\n');
    expect(lines[2]).toBe('| ❌ | b | x \\| y |');
    expect(lines[3]).toBe('| ✅ | a | fine |');
  });
});
