import { join } from 'node:path';

import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApplicationsModule } from './applications/applications.module';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { MatchingModule } from './matching/matching.module';
import { ProfilesModule } from './profiles/profiles.module';
import { VacanciesModule } from './vacancies/vacancies.module';
import { redisConnectionFromUrl } from './redis';

@Module({
  imports: [
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
    MatchingModule,
    ProfilesModule,
    VacanciesModule,
    ApplicationsModule,
    IngestionModule,
  ],
})
export class AppModule {}
