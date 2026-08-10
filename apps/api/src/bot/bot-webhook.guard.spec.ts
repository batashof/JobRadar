import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';

import { BotWebhookGuard, TELEGRAM_SECRET_HEADER } from './bot-webhook.guard';

const contextWith = (headers: Record<string, string | string[]>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

const guardWith = (secret?: string) =>
  new BotWebhookGuard({ get: () => secret } as unknown as ConfigService);

describe('BotWebhookGuard', () => {
  it('accepts the secret Telegram echoes back', () => {
    expect(guardWith('shh').canActivate(contextWith({ [TELEGRAM_SECRET_HEADER]: 'shh' }))).toBe(true);
  });

  it('rejects a wrong or missing secret', () => {
    const guard = guardWith('shh');
    expect(() => guard.canActivate(contextWith({ [TELEGRAM_SECRET_HEADER]: 'nope' }))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
  });

  it('rejects a prefix of the secret (length is compared before the bytes)', () => {
    expect(() => guardWith('shh').canActivate(contextWith({ [TELEGRAM_SECRET_HEADER]: 'sh' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('refuses to serve at all when no secret is configured', () => {
    // An unset secret must never mean "let everyone in" — the endpoint is public.
    expect(() => guardWith(undefined).canActivate(contextWith({ [TELEGRAM_SECRET_HEADER]: 'shh' }))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('reads the first value when the header arrives repeated', () => {
    expect(
      guardWith('shh').canActivate(contextWith({ [TELEGRAM_SECRET_HEADER]: ['shh', 'other'] })),
    ).toBe(true);
  });
});
