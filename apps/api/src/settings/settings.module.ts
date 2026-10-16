import { Module } from '@nestjs/common';

import { BotModule } from '../bot/bot.module';
import { CandidateModule } from '../candidate/candidate.module';
import { SettingsBotService } from './settings-bot.service';

/** `/settings` and `/filters` in the bot (roadmap 5.3, 5.10). */
@Module({
  imports: [BotModule, CandidateModule],
  providers: [SettingsBotService],
})
export class SettingsModule {}
