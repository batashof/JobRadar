import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { buildPoolConfig } from './pool-config';
import * as schema from './schema';

export const DB = Symbol('DB');

export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Database => {
        // Pool connects lazily: the app can boot without a reachable DB
        // (e.g. the hello-world deploy) and only fails on first query.
        // DATABASE_CA_CERT: the provider's root CA (Supabase, ADR-019), so TLS
        // is verified rather than disabled.
        const pool = new Pool(
          buildPoolConfig(config.get<string>('DATABASE_URL'), config.get<string>('DATABASE_CA_CERT')),
        );
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
