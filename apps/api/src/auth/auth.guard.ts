import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '@jobradar/shared';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { parseCookies } from './cookies';
import { SESSION_COOKIE } from './session';

/** Request augmented with the authenticated user, set by AuthGuard. */
export interface AuthedRequest extends Request {
  user?: AuthUser;
}

/** Rejects requests without a valid session cookie; attaches `req.user` otherwise. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const user = await this.auth.validateSession(token ?? '');
    if (!user) throw new UnauthorizedException();
    request.user = user;
    return true;
  }
}
