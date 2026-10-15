import { Module } from '@nestjs/common';

import { BotModule } from '../bot/bot.module';
import { SettingsBotService } from './settings-bot.service';

/** `/settings` in the bot (roadmap 5.3). */
@Module({
  imports: [BotModule],
  providers: [SettingsBotService],
})
export class SettingsModule {}
