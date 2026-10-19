import { Module } from '@nestjs/common';

import { BotModule } from '../bot/bot.module';
import { FeedbackBotService } from './feedback-bot.service';
import { StatsService } from './stats.service';

/**
 * Knowing how the bot is doing (v2.6.0): the owner's `/stats` and the users'
 * `/feedback`. Error alerts live in `BotService.reportError`, next to the
 * update loop that catches them.
 */
@Module({
  imports: [BotModule],
  providers: [StatsService, FeedbackBotService],
})
export class StatsModule {}
