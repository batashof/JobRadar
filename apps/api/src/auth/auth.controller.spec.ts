import type { AuthUser } from '@jobradar/shared';
import type { Request, Response } from 'express';

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import { SESSION_COOKIE } from './session';

const user: AuthUser = { id: 'u1', email: 'a@b.com', digestEnabled: true };

function fakeResponse() {
  const cookies: { name: string; value?: string }[] = [];
  const res = {
    cookie: jest.fn((name: string, value: string) => cookies.push({ name, value })),
    clearCookie: jest.fn((name: string) => cookies.push({ name })),
  };
  return { res: res as unknown as Response, cookies, spy: res };
}

describe('AuthController', () => {
  const expiresAt = new Date(Date.now() + 60_000);

  it('signup sets a session cookie and returns the user', async () => {
    const auth = {
      signup: jest.fn().mockResolvedValue({ user, token: 'tok', expiresAt }),
    } as unknown as AuthService;
    const controller = new AuthController(auth);
    const { res, spy } = fakeResponse();

    const result = await controller.signup({ email: 'a@b.com', password: 'pw' }, res);

    expect(result).toEqual({ user });
    expect(spy.cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'tok', expect.objectContaining({
      httpOnly: true,
    }));
  });

  it('login sets a session cookie and returns the user', async () => {
    const auth = {
      login: jest.fn().mockResolvedValue({ user, token: 'tok2', expiresAt }),
    } as unknown as AuthService;
    const controller = new AuthController(auth);
    const { res, spy } = fakeResponse();

    const result = await controller.login({ email: 'a@b.com', password: 'pw' }, res);

    expect(result).toEqual({ user });
    expect(spy.cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'tok2', expect.anything());
  });

  it('logout revokes the token from the cookie and clears it', async () => {
    const revokeSession = jest.fn().mockResolvedValue(undefined);
    const auth = { revokeSession } as unknown as AuthService;
    const controller = new AuthController(auth);
    const { res, spy } = fakeResponse();
    const req = { headers: { cookie: `${SESSION_COOKIE}=abc` } } as unknown as Request;

    await controller.logout(req, res);

    expect(revokeSession).toHaveBeenCalledWith('abc');
    expect(spy.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, expect.anything());
  });

  it('logout without a cookie still clears and does not revoke', async () => {
    const revokeSession = jest.fn();
    const auth = { revokeSession } as unknown as AuthService;
    const controller = new AuthController(auth);
    const { res, spy } = fakeResponse();
    const req = { headers: {} } as unknown as Request;

    await controller.logout(req, res);

    expect(revokeSession).not.toHaveBeenCalled();
    expect(spy.clearCookie).toHaveBeenCalled();
  });

  it('me returns the injected current user', () => {
    const controller = new AuthController({} as unknown as AuthService);
    expect(controller.me(user)).toEqual({ user });
  });
});
