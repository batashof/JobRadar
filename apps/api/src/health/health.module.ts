import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { INGESTION_QUEUE } from '../ingestion/ingestion.types';
import { HealthController } from './health.controller';

@Module({
  imports: [BullModule.registerQueue({ name: INGESTION_QUEUE })],
  controllers: [HealthController],
})
export class HealthModule {}
