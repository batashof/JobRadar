import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { DigestController } from './digest.controller';
import { DigestService } from './digest.service';

/**
 * Daily vacancy digest. This increment is the schedule configuration; the
 * funnel (rules → batch scoring → detailed scoring), the cron and the Telegram
 * cards with an Apply button follow, delivered over `BotModule`.
 */
@Module({
  imports: [AuthModule, BotModule],
  controllers: [DigestController],
  providers: [DigestService],
  exports: [DigestService],
})
export class DigestModule {}
