import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type AuthResponse,
  type LoginInput,
  loginSchema,
  type SignupInput,
  signupSchema,
} from '@jobradar/shared';
import type { Request, Response } from 'express';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { parseCookies } from './cookies';
import { CurrentUser } from './current-user.decorator';
import { SESSION_COOKIE, sessionCookieOptions } from './session';
import type { AuthUser } from '@jobradar/shared';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @HttpCode(201)
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: SignupInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, token, expiresAt } = await this.auth.signup(body);
    this.setSessionCookie(res, token, expiresAt);
    return { user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, token, expiresAt } = await this.auth.login(body);
    this.setSessionCookie(res, token, expiresAt);
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await this.auth.revokeSession(token);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser): AuthResponse {
    return { user };
  }

  private setSessionCookie(res: Response, token: string, expiresAt: Date): void {
    const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
  }
}
