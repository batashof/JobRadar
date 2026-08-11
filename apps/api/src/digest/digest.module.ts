import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { LlmModule } from '../llm/llm.module';
import { DigestController } from './digest.controller';
import { DigestScheduler } from './digest.scheduler';
import { DigestSendService } from './digest-send.service';
import { DigestService } from './digest.service';

/**
 * Daily vacancy digest: schedule settings, the pick-score-send funnel, and the
 * Telegram cards it produces. Runs on its own in-process interval for the same
 * reasons as the planner tick (revised ADR-015 §7) — per-user local send times
 * cannot be expressed as an external cron without firing constantly.
 */
@Module({
  imports: [AuthModule, BotModule, LlmModule],
  controllers: [DigestController],
  providers: [DigestService, DigestSendService, DigestScheduler],
  exports: [DigestService, DigestSendService],
})
export class DigestModule {}
