import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { HhIngestService } from './hh/hh.service';
import { RemoteOkIngestService } from './remoteok/remoteok.service';
import { IngestionController } from './ingestion.controller';
import { IngestionProcessor } from './ingestion.processor';
import { INGESTION_QUEUE } from './ingestion.types';
import { IngestionTokenGuard } from './ingestion-token.guard';

@Module({
  imports: [BullModule.registerQueue({ name: INGESTION_QUEUE })],
  controllers: [IngestionController],
  providers: [IngestionProcessor, HhIngestService, RemoteOkIngestService, IngestionTokenGuard],
})
export class IngestionModule {}
