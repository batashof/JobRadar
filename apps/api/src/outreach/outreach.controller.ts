import { Controller, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthUser, BriefResponse, CoverLetterResponse } from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OutreachService } from './outreach.service';

/** Apply-assistant actions living under the vacancy detail page (ADR-011). */
@Controller('vacancies')
@UseGuards(AuthGuard)
export class OutreachController {
  constructor(private readonly outreach: OutreachService) {}

  @Post(':id/brief')
  brief(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('force') force?: string,
  ): Promise<BriefResponse> {
    return this.outreach.brief(user.id, id, force === 'true');
  }

  @Post(':id/cover-letter')
  coverLetter(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CoverLetterResponse> {
    return this.outreach.coverLetter(user.id, id);
  }
}
