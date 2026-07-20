import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@jobradar/shared';

import type { AuthedRequest } from './auth.guard';

/** Injects the authenticated user attached by AuthGuard. Use only on guarded routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!request.user) {
      // Programming error: the route is missing @UseGuards(AuthGuard).
      throw new Error('CurrentUser used on a route without AuthGuard');
    }
    return request.user;
  },
);
