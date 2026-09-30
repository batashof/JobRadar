import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthChecks, HealthResponse } from '@jobradar/shared';
import { sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { LlmService } from '../llm/llm.service';
import { probeRedis, redisConnectionFromUrl } from '../redis';

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

/** Hostname of a connection URL, never its credentials; null if unset or invalid. */
const hostOf = (url: string | undefined): string | null => {
  try {
    return url ? new URL(url.trim()).hostname || null : null;
  } catch {
    return null;
  }
};

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly llm: LlmService,
  ) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    const redisConn = redisConnectionFromUrl(
      this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
    );

    const [dbProbe, redisProbe] = await Promise.all([
      this.checkDb(),
      redisConn
        ? probeRedis(redisConn)
        : Promise.resolve({ ok: false as const, error: 'REDIS_URL is not a valid redis URL' }),
    ]);

    const checks: HealthChecks = {
      db: dbProbe.ok ? 'ok' : 'unreachable',
      dbHost: hostOf(this.config.get<string>('DATABASE_URL')),
      dbCaConfigured: Boolean(this.config.get<string>('DATABASE_CA_CERT')?.trim()),
      dbError: dbProbe.ok ? null : dbProbe.error,
      redis: redisProbe.ok ? 'ok' : 'unreachable',
      redisHost: redisConn?.host ?? null,
      redisPort: redisConn?.port ?? null,
      redisTls: Boolean(redisConn && 'tls' in redisConn),
      redisError: redisProbe.ok ? null : redisProbe.error,
      ingestionTokenConfigured: Boolean(this.config.get<string>('INGESTION_TOKEN')),
      telegramConfigured: Boolean(
        this.config.get<string>('TELEGRAM_API_ID') &&
          this.config.get<string>('TELEGRAM_API_HASH') &&
          this.config.get<string>('TELEGRAM_SESSION'),
      ),
      linkedinAlertsConfigured: Boolean(
        this.config.get<string>('ALERTS_IMAP_USER') &&
          this.config.get<string>('ALERTS_IMAP_PASSWORD'),
      ),
      botConfigured: Boolean(this.config.get<string>('TELEGRAM_BOT_TOKEN')),
      sentryConfigured: Boolean(this.config.get<string>('SENTRY_DSN')),
      llmProviders: this.llm.configuredProviderNames(),
      llmStatus: this.llm.providerStatus(),
    };

    return {
      status: 'ok',
      service: 'jobradar-api',
      version,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDb(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await withTimeout(this.db.execute(sql`select 1`), 1500);
      return { ok: true };
    } catch (error) {
      // Drizzle wraps the driver error ("Failed query: ..."); the cause says
      // what actually went wrong (TLS, auth, DNS). pg never echoes the password.
      const { cause } = error as Error;
      const root = cause instanceof Error ? cause : (error as Error);
      return { ok: false, error: root.message.slice(0, 160) };
    }
  }
}
