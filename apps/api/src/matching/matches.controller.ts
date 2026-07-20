import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  type AuthUser,
  type MatchFeed,
  type MatchProfileOption,
  type MatchQuery,
  matchQuerySchema,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MatchesService } from './matches.service';

@Controller('matches')
@UseGuards(AuthGuard)
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  feed(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(matchQuerySchema)) query: MatchQuery,
  ): Promise<MatchFeed> {
    return this.matches.feed(user.id, query);
  }

  @Get('profiles')
  listProfileOptions(@CurrentUser() user: AuthUser): Promise<MatchProfileOption[]> {
    return this.matches.listProfileOptions(user.id);
  }
}
