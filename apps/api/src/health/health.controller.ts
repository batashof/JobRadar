import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthChecks, HealthResponse } from '@jobradar/shared';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { INGESTION_QUEUE } from '../ingestion/ingestion.types';
import { redisConnectionFromUrl } from '../redis';

// Runtime require keeps package.json out of the tsc program (it would shift rootDir).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../../package.json') as { version: string };

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @InjectQueue(INGESTION_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const checks: HealthChecks = {
      db,
      redis,
      redisHost:
        redisConnectionFromUrl(this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379')
          ?.host ?? null,
      ingestionTokenConfigured: Boolean(this.config.get<string>('INGESTION_TOKEN')),
    };

    return {
      status: 'ok',
      service: 'jobradar-api',
      version,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDb(): Promise<HealthChecks['db']> {
    try {
      await withTimeout(this.db.execute(sql`select 1`), 1500);
      return 'ok';
    } catch {
      return 'unreachable';
    }
  }

  private async checkRedis(): Promise<HealthChecks['redis']> {
    try {
      const client = (await withTimeout(Promise.resolve(this.queue.client), 1500)) as unknown as {
        ping(): Promise<string>;
      };
      await withTimeout(client.ping(), 1500);
      return 'ok';
    } catch {
      return 'unreachable';
    }
  }
}
