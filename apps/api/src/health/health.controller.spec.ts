import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DB } from '../db/db.module';
import { INGESTION_QUEUE } from '../ingestion/ingestion.types';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  const dbMock = { execute: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
  const queueMock = { client: Promise.resolve({ ping: jest.fn().mockResolvedValue('PONG') }) };
  const configMock = {
    get: (key: string) =>
      ({ REDIS_URL: 'redis://localhost:6379', INGESTION_TOKEN: 'secret' })[key],
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DB, useValue: dbMock },
        { provide: getQueueToken(INGESTION_QUEUE), useValue: queueMock },
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
      redisTls: false,
      ingestionTokenConfigured: true,
    });
    expect(JSON.stringify(health)).not.toContain('secret');
  });

  it('degrades to unreachable when a component fails, still returning 200-shape', async () => {
    dbMock.execute.mockRejectedValueOnce(new Error('conn refused'));
    const health = await controller.getHealth();

    expect(health.status).toBe('ok');
    expect(health.checks?.db).toBe('unreachable');
  });
});
