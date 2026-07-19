import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { redisConnectionFromUrl } from './redis';

@Module({
  imports: [
    // Local dev reads the repo-root .env; hosted envs provide real env vars.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnectionFromUrl(
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        ),
      }),
    }),
    DbModule,
    HealthModule,
    IngestionModule,
  ],
})
export class AppModule {}
