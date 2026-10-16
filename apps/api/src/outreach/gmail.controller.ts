import { Controller, Delete, Get, HttpCode, Query, Res, UseGuards } from '@nestjs/common';
import type { AuthUser, GmailStatus } from '@jobradar/shared';
import type { Response } from 'express';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { type GmailCallbackOutcome, gmailCallbackPage } from './gmail-callback-page';
import { GmailService } from './gmail.service';

@Controller('gmail')
export class GmailController {
  constructor(private readonly gmail: GmailService) {}

  @Get('status')
  @UseGuards(AuthGuard)
  status(@CurrentUser() user: AuthUser): Promise<GmailStatus> {
    return this.gmail.statusFor(user.id);
  }

  @Get('oauth/start')
  @UseGuards(AuthGuard)
  start(@CurrentUser() user: AuthUser): { url: string } {
    return { url: this.gmail.authUrl(user.id) };
  }

  /**
   * Google redirects here after the consent screen opened from `/gmail` in the
   * bot. Identity comes from the signed `state`, not a session. The answer is a
   * tiny page telling the author to go back to Telegram: there is no web app to
   * return to since 2.0.0.
   */
  @Get('oauth/callback')
  async callback(
    @Res() res: Response,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    let outcome: GmailCallbackOutcome = 'denied';
    if (!error && code && state) {
      try {
        await this.gmail.handleCallback(code, state);
        outcome = 'connected';
      } catch {
        outcome = 'error';
      }
    }
    res
      .status(outcome === 'error' ? 400 : 200)
      .type('html')
      .send(gmailCallbackPage(outcome));
  }

  @Delete('connection')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  disconnect(@CurrentUser() user: AuthUser): Promise<void> {
    return this.gmail.disconnect(user.id);
  }
}
