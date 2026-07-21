import { join } from 'node:path';

import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { ApplicationsModule } from './applications/applications.module';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { LlmModule } from './llm/llm.module';
import { MatchingModule } from './matching/matching.module';
import { OutreachModule } from './outreach/outreach.module';
import { ProfilesModule } from './profiles/profiles.module';
import { ResumesModule } from './resumes/resumes.module';
import { VacanciesModule } from './vacancies/vacancies.module';
import { redisConnectionFromUrl } from './redis';

@Module({
  imports: [
    // Sentry first so it can hook into the modules registered after it. A no-op
    // when SENTRY_DSN is unset (see instrument.ts).
    SentryModule.forRoot(),
    // Local dev reads the repo-root .env (resolved from the compiled file, so it
    // works regardless of cwd); hosted envs provide real env vars.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [join(__dirname, '../../../.env')] }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const raw = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        const connection = redisConnectionFromUrl(raw);
        if (!connection) {
          // Never crash bootstrap over a malformed env var: keep /health alive
          // and make the problem visible in logs and /health diagnostics.
          new Logger('BullModule').error(
            'REDIS_URL is not a valid redis:// or rediss:// URL — queue jobs will not run',
          );
          return { connection: { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null } };
        }
        return { connection };
      },
    }),
    DbModule,
    HealthModule,
    AuthModule,
    LlmModule,
    MatchingModule,
    OutreachModule,
    ProfilesModule,
    ResumesModule,
    VacanciesModule,
    ApplicationsModule,
    IngestionModule,
  ],
  providers: [
    // Reports unhandled exceptions from HTTP handlers to Sentry while preserving
    // Nest's default error responses. Inert when Sentry is disabled.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule {}
