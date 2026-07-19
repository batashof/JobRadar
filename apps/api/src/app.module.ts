import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Local dev reads the repo-root .env; hosted envs provide real env vars.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    DbModule,
    HealthModule,
  ],
})
export class AppModule {}
