import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DB } from '../db/db.module';
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
    });
    expect(JSON.stringify(health)).not.toContain('secret');
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
