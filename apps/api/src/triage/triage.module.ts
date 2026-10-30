import { Module } from '@nestjs/common';

import { BotModule } from '../bot/bot.module';
import { TriageBotService } from './triage-bot.service';

/**
 * The bug and feedback inbox (ADR-036). Errors and /feedback are written to
 * it by `BotService.reportError` and `FeedbackBotService`; this module is the
 * owner's `/triage` and its buttons.
 */
@Module({
  imports: [BotModule],
  providers: [TriageBotService],
})
export class TriageModule {}
