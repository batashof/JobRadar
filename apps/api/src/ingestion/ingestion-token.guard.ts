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

/** Shared-token auth for the ingestion hook (called by GitHub Actions cron, ADR-006). */
@Injectable()
export class IngestionTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('INGESTION_TOKEN');
    if (!expected) {
      throw new ServiceUnavailableException('INGESTION_TOKEN is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = (request.headers.authorization ?? '').replace(/^Bearer /, '');

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    const ok =
      expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
    if (!ok) throw new UnauthorizedException();
    return true;
  }
}
