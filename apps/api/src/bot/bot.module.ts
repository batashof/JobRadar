import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BotController, BotWebhookController } from './bot.controller';
import { BotService } from './bot.service';

/**
 * Shared Telegram bot channel (ADR-015 §6) — Bot API, outbound `sendMessage`
 * plus a secret-guarded webhook. Features import this module and register
 * their own button handlers by namespace, so the bot never depends on them.
 *
 * Entirely optional: with no `TELEGRAM_BOT_TOKEN` the service reports itself
 * unconfigured and every send is a no-op.
 */
@Module({
  imports: [AuthModule],
  controllers: [BotController, BotWebhookController],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
