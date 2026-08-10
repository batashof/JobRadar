import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Guards the public Telegram webhook. Telegram echoes the secret we registered
 * with `setWebhook` in this header on every update, which is the only thing
 * standing between the endpoint and the open internet — so an unset secret is
 * a hard 503, never an open door.
 */
export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

@Injectable()
export class BotWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('TELEGRAM_BOT_WEBHOOK_SECRET');
    if (!expected) {
      throw new ServiceUnavailableException('TELEGRAM_BOT_WEBHOOK_SECRET is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[TELEGRAM_SECRET_HEADER];
    const provided = Array.isArray(header) ? (header[0] ?? '') : (header ?? '');

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    const ok =
      expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
    if (!ok) throw new UnauthorizedException();
    return true;
  }
}
