import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { BotModule } from '../bot/bot.module';
import { DedupModule } from '../dedup/dedup.module';
import { AtsIngestService } from './ats/ats.service';
import { MatchingModule } from '../matching/matching.module';
import { HhIngestService } from './hh/hh.service';
import { HimalayasIngestService } from './himalayas/himalayas.service';
import { HnIngestService } from './hn/hn.service';
import { JobicyIngestService } from './jobicy/jobicy.service';
import { LinkedInAlertsIngestService } from './linkedin/linkedin-alerts.service';
import { LinkedInBotService } from './linkedin/linkedin-bot.service';
import { RemoteOkIngestService } from './remoteok/remoteok.service';
import { RemotiveIngestService } from './remotive/remotive.service';
import { TelegramIngestService } from './telegram/telegram.service';
import { WorkingNomadsIngestService } from './workingnomads/workingnomads.service';
import { UaBoardsIngestService } from './ua-boards/ua-boards.service';
import { WwrIngestService } from './wwr/wwr.service';
import { IngestionController } from './ingestion.controller';
import { IngestionProcessor } from './ingestion.processor';
import { INGESTION_QUEUE } from './ingestion.types';
import { IngestionTokenGuard } from './ingestion-token.guard';

@Module({
  imports: [
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
    BotModule,
    DedupModule,
    MatchingModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionProcessor,
    HhIngestService,
    RemoteOkIngestService,
    RemotiveIngestService,
    JobicyIngestService,
    HimalayasIngestService,
    HnIngestService,
    AtsIngestService,
    WorkingNomadsIngestService,
    TelegramIngestService,
    WwrIngestService,
    UaBoardsIngestService,
    LinkedInAlertsIngestService,
    LinkedInBotService,
    IngestionTokenGuard,
  ],
})
export class IngestionModule {}
