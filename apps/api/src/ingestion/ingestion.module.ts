import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { DedupModule } from '../dedup/dedup.module';
import { MatchingModule } from '../matching/matching.module';
import { HhIngestService } from './hh/hh.service';
import { RemoteOkIngestService } from './remoteok/remoteok.service';
import { TelegramIngestService } from './telegram/telegram.service';
import { WwrIngestService } from './wwr/wwr.service';
import { IngestionController } from './ingestion.controller';
import { IngestionProcessor } from './ingestion.processor';
import { INGESTION_QUEUE } from './ingestion.types';
import { IngestionTokenGuard } from './ingestion-token.guard';

@Module({
  imports: [BullModule.registerQueue({ name: INGESTION_QUEUE }), DedupModule, MatchingModule],
  controllers: [IngestionController],
  providers: [
    IngestionProcessor,
    HhIngestService,
    RemoteOkIngestService,
    TelegramIngestService,
    WwrIngestService,
    IngestionTokenGuard,
  ],
})
export class IngestionModule {}
