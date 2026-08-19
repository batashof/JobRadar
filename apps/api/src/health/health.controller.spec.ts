import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DB } from '../db/db.module';
import { LlmService } from '../llm/llm.service';
import { probeRedis } from '../redis';
import { HealthController } from './health.controller';

jest.mock('../redis', () => ({
  ...jest.requireActual('../redis'),
  probeRedis: jest.fn(),
}));

const probeRedisMock = probeRedis as jest.MockedFunction<typeof probeRedis>;

describe('HealthController', () => {
  let controller: HealthController;

  const dbMock = { execute: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
  const configMock = {
    get: (key: string) =>
      ({ REDIS_URL: 'redis://localhost:6379', INGESTION_TOKEN: 'secret' })[key],
  };

  beforeEach(async () => {
    probeRedisMock.mockResolvedValue({ ok: true });
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DB, useValue: dbMock },
        { provide: ConfigService, useValue: configMock },
        {
          provide: LlmService,
          useValue: { configuredProviderNames: () => [], providerStatus: () => [] },
        },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reports ok status with service metadata', async () => {
    const health = await controller.getHealth();

    expect(health.status).toBe('ok');
    expect(health.service).toBe('jobradar-api');
    expect(health.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });

  it('reports component diagnostics without secrets', async () => {
    const health = await controller.getHealth();

    expect(health.checks).toEqual({
      db: 'ok',
      redis: 'ok',
      redisHost: 'localhost',
      redisPort: 6379,
      redisTls: false,
      redisError: null,
      ingestionTokenConfigured: true,
      telegramConfigured: false,
      botConfigured: false,
      sentryConfigured: false,
      llmProviders: [],
      llmStatus: [],
    });
    expect(JSON.stringify(health)).not.toContain('secret');
  });

  it('reports each provider’s last call, so a silently failing chain is visible', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DB, useValue: dbMock },
        { provide: ConfigService, useValue: configMock },
        {
          provide: LlmService,
          useValue: {
            configuredProviderNames: () => ['groq', 'gemini'],
            providerStatus: () => [
              {
                name: 'groq',
                model: 'llama-3.3-70b-versatile',
                lastOutcome: 'failed',
                lastError: 'HTTP 403 Access denied',
                lastAt: '2026-08-20T00:00:00.000Z',
              },
              {
                name: 'gemini',
                model: 'gemini-flash-latest',
                lastOutcome: 'ok',
                lastError: null,
                lastAt: '2026-08-20T00:00:01.000Z',
              },
            ],
          },
        },
      ],
    }).compile();

    const health = await moduleRef.get(HealthController).getHealth();

    expect(health.checks?.llmStatus).toHaveLength(2);
    expect(health.checks?.llmStatus[0]).toMatchObject({
      name: 'groq',
      lastOutcome: 'failed',
      lastError: 'HTTP 403 Access denied',
    });
    expect(health.checks?.llmStatus[1]?.lastOutcome).toBe('ok');
  });

  it('surfaces the redis failure detail when the probe fails', async () => {
    probeRedisMock.mockResolvedValue({ ok: false, error: 'WRONGPASS invalid username-password pair' });
    const health = await controller.getHealth();

    expect(health.checks?.redis).toBe('unreachable');
    expect(health.checks?.redisError).toContain('WRONGPASS');
  });

  it('degrades db to unreachable on failure, still returning ok status', async () => {
    dbMock.execute.mockRejectedValueOnce(new Error('conn refused'));
    const health = await controller.getHealth();

    expect(health.status).toBe('ok');
    expect(health.checks?.db).toBe('unreachable');
  });
});
