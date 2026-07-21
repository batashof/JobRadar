import { Body, Controller, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  type ApplyEmailDraft,
  type ApplyEmailDraftInput,
  applyEmailDraftSchema,
  type ApplyEmailSendInput,
  applyEmailSendSchema,
  type AuthUser,
  type BriefResponse,
  type CoverLetterResponse,
  type ResumeMatchResponse,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
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

  @Post(':id/resume-match')
  resumeMatch(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResumeMatchResponse> {
    return this.outreach.resumeMatch(user.id, id);
  }

  @Post(':id/apply-email/draft')
  draftApplyEmail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(applyEmailDraftSchema)) body: ApplyEmailDraftInput,
  ): Promise<ApplyEmailDraft> {
    return this.outreach.draftApplyEmail(user.id, id, body.coverLetter);
  }

  @Post(':id/apply-email/send')
  sendApplyEmail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(applyEmailSendSchema)) body: ApplyEmailSendInput,
  ) {
    return this.outreach.sendApplyEmail(user.id, id, body);
  }
}
