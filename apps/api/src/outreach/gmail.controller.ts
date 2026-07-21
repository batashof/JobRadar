import { Controller, Delete, Get, HttpCode, Query, Res, UseGuards } from '@nestjs/common';
import type { AuthUser, GmailStatus } from '@jobradar/shared';
import type { Response } from 'express';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
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
   * Google redirects here (API origin — the session cookie lives on the web
   * origin, so identity comes from the signed `state`, not the session).
   */
  @Get('oauth/callback')
  async callback(
    @Res() res: Response,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const back = `${this.gmail.webOrigin()}/app/resume`;
    if (error || !code || !state) {
      res.redirect(`${back}?gmail=denied`);
      return;
    }
    try {
      await this.gmail.handleCallback(code, state);
      res.redirect(`${back}?gmail=connected`);
    } catch {
      res.redirect(`${back}?gmail=error`);
    }
  }

  @Delete('connection')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  disconnect(@CurrentUser() user: AuthUser): Promise<void> {
    return this.gmail.disconnect(user.id);
  }
}
