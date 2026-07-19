import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@jobradar/shared';

// Runtime require keeps package.json out of the tsc program (it would shift rootDir).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../../package.json') as { version: string };

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'jobradar-api',
      version,
      timestamp: new Date().toISOString(),
    };
  }
}
