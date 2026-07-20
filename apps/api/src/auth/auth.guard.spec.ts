import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@jobradar/shared';

import { AuthGuard, type AuthedRequest } from './auth.guard';
import type { AuthService } from './auth.service';
import { SESSION_COOKIE } from './session';

const user: AuthUser = { id: 'u1', email: 'a@b.com', digestEnabled: true };

function contextFor(request: Partial<AuthedRequest>): { ctx: ExecutionContext; request: AuthedRequest } {
  const req = request as AuthedRequest;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, request: req };
}

describe('AuthGuard', () => {
  it('allows a request with a valid session and attaches the user', async () => {
    const auth = { validateSession: jest.fn().mockResolvedValue(user) } as unknown as AuthService;
    const guard = new AuthGuard(auth);
    const { ctx, request } = contextFor({ headers: { cookie: `${SESSION_COOKIE}=good` } });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(auth.validateSession).toHaveBeenCalledWith('good');
    expect(request.user).toEqual(user);
  });

  it('rejects a request with no session cookie', async () => {
    const auth = { validateSession: jest.fn().mockResolvedValue(null) } as unknown as AuthService;
    const guard = new AuthGuard(auth);
    const { ctx } = contextFor({ headers: {} });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.validateSession).toHaveBeenCalledWith('');
  });

  it('rejects a request whose session is invalid or expired', async () => {
    const auth = { validateSession: jest.fn().mockResolvedValue(null) } as unknown as AuthService;
    const guard = new AuthGuard(auth);
    const { ctx } = contextFor({ headers: { cookie: `${SESSION_COOKIE}=stale` } });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
