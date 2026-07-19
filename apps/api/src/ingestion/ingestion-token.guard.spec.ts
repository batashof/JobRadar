import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IngestionTokenGuard } from './ingestion-token.guard';

const contextWithAuth = (authorization?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  }) as unknown as ExecutionContext;

const guardWithToken = (token?: string): IngestionTokenGuard =>
  new IngestionTokenGuard({ get: () => token } as unknown as ConfigService);

describe('IngestionTokenGuard', () => {
  it('rejects with 503 when the token is not configured', () => {
    expect(() => guardWithToken(undefined).canActivate(contextWithAuth('Bearer x'))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects a missing or wrong bearer token', () => {
    const guard = guardWithToken('secret');
    expect(() => guard.canActivate(contextWithAuth(undefined))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWithAuth('Bearer nope'))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts the correct bearer token', () => {
    expect(guardWithToken('secret').canActivate(contextWithAuth('Bearer secret'))).toBe(true);
  });
});
