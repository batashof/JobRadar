import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reports ok status with service metadata', () => {
    const health = controller.getHealth();

    expect(health.status).toBe('ok');
    expect(health.service).toBe('jobradar-api');
    expect(health.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });
});
