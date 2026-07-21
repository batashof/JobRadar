import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  type AuthUser,
  type MatchFeed,
  type MatchProfileOption,
  type MatchQuery,
  matchQuerySchema,
  type ResumeMatchRunResult,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MatchesService } from './matches.service';
import { ResumeMatchingService } from './resume-matching.service';

@Controller('matches')
@UseGuards(AuthGuard)
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly resumeMatching: ResumeMatchingService,
  ) {}

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

  /** Budget-capped on-demand LLM scoring run for the caller's active resume. */
  @Post('resume-score')
  scoreResume(@CurrentUser() user: AuthUser): Promise<ResumeMatchRunResult> {
    return this.resumeMatching.scorePending(undefined, user.id);
  }
}
