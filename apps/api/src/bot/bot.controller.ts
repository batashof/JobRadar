import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser, TelegramLinkStart, TelegramLinkStatus } from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { TelegramUpdate } from './bot-update';
import { BotWebhookGuard } from './bot-webhook.guard';
import { BotService } from './bot.service';

/** Account-side of the bot link. Everything here is user-scoped and authenticated. */
@Controller('bot/telegram')
@UseGuards(AuthGuard)
export class BotController {
  constructor(private readonly bot: BotService) {}

  @Get()
  status(@CurrentUser() user: AuthUser): Promise<TelegramLinkStatus> {
    return this.bot.linkStatus(user.id);
  }

  @Post('link')
  async startLink(@CurrentUser() user: AuthUser): Promise<TelegramLinkStart> {
    if (!this.bot.isConfigured()) {
      throw new BadRequestException('Telegram bot is not configured');
    }
    return this.bot.startLink(user.id);
  }

  @Delete()
  unlink(@CurrentUser() user: AuthUser): Promise<TelegramLinkStatus> {
    return this.bot.unlink(user.id);
  }
}

/**
 * The webhook Telegram itself calls — unauthenticated by session, guarded by
 * Telegram's secret-token header instead. Kept as a separate controller so the
 * session `AuthGuard` above can never accidentally apply to it.
 */
@Controller('bot/telegram')
export class BotWebhookController {
  constructor(private readonly bot: BotService) {}

  @Post('webhook')
  @UseGuards(BotWebhookGuard)
  @HttpCode(200)
  async webhook(@Body() update: TelegramUpdate): Promise<{ ok: true }> {
    // Always 200, even on a malformed update: a non-2xx makes Telegram retry
    // the same broken update for hours.
    await this.bot.handleUpdate(update ?? {});
    return { ok: true };
  }
}
