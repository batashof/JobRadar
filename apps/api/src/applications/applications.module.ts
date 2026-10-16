import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { ApplicationRemindersScheduler } from './application-reminders.scheduler';
import { ApplicationRemindersService } from './application-reminders.service';
import { ApplicationsBotService } from './applications-bot.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

/**
 * Job applications: the board's REST API, `/applications` in the bot and its
 * follow-up reminders (roadmap 5.5). Exports the service so the digest card's
 * "✅ Applied" button can put a vacancy on the board.
 */
@Module({
  imports: [AuthModule, BotModule],
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    ApplicationsBotService,
    ApplicationRemindersService,
    ApplicationRemindersScheduler,
  ],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
