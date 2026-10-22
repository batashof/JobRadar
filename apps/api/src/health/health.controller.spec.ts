import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DB } from '../db/db.module';
import { LlmService } from '../llm/llm.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  const dbMock = { execute: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
  const configMock = {
    get: (key: string) =>
      ({
        INGESTION_TOKEN: 'secret',
        DATABASE_URL:
          'postgresql://postgres.ref:dbsecret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
        DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----',
      })[key],
  };

  beforeEach(async () => {
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
      dbHost: 'aws-0-eu-central-1.pooler.supabase.com',
      dbCaConfigured: true,
      dbError: null,
      ingestionTokenConfigured: true,
      telegramConfigured: false,
      linkedinAlertsConfigured: false,
      botConfigured: false,
      sentryConfigured: false,
      llmProviders: [],
      llmStatus: [],
    });
    expect(JSON.stringify(health)).not.toContain('secret');
    expect(JSON.stringify(health)).not.toContain('postgres.ref');
  });

  it('reports the LinkedIn alert mailbox as configured without exposing it', async () => {
    const env: Record<string, string> = {
      ALERTS_IMAP_USER: 'alerts@example.com',
      ALERTS_IMAP_PASSWORD: 'app-pass-secret',
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DB, useValue: dbMock },
        { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
        {
          provide: LlmService,
          useValue: { configuredProviderNames: () => [], providerStatus: () => [] },
        },
      ],
    }).compile();

    const health = await moduleRef.get(HealthController).getHealth();

    expect(health.checks?.linkedinAlertsConfigured).toBe(true);
    expect(JSON.stringify(health)).not.toContain('alerts@example.com');
    expect(JSON.stringify(health)).not.toContain('app-pass-secret');
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

  it('no longer reports Redis: nothing uses it since ADR-031', async () => {
    const health = await controller.getHealth();
    expect(JSON.stringify(health.checks)).not.toContain('redis');
  });

  it('degrades db to unreachable on failure, still returning ok status', async () => {
    dbMock.execute.mockRejectedValueOnce(new Error('conn refused'));
    const health = await controller.getHealth();

    expect(health.status).toBe('ok');
    expect(health.checks?.db).toBe('unreachable');
    expect(health.checks?.dbError).toBe('conn refused');
  });

  it('surfaces the driver error behind drizzle’s "Failed query" wrapper', async () => {
    const cause = new Error('self-signed certificate in certificate chain');
    dbMock.execute.mockRejectedValueOnce(new Error('Failed query: select 1', { cause }));
    const health = await controller.getHealth();

    expect(health.checks?.dbError).toBe('self-signed certificate in certificate chain');
  });

  it('reports no db host and no CA when neither is configured', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DB, useValue: dbMock },
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: LlmService,
          useValue: { configuredProviderNames: () => [], providerStatus: () => [] },
        },
      ],
    }).compile();

    const health = await moduleRef.get(HealthController).getHealth();

    expect(health.checks).toMatchObject({ dbHost: null, dbCaConfigured: false });
  });
});
