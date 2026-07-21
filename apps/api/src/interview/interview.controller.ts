import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthUser,
  type GeneratePlanInput,
  generatePlanSchema,
  type GenerateQuestionsInput,
  generateQuestionsSchema,
  type InterviewAnswerReview,
  type InterviewModelAnswerResponse,
  type InterviewPlanDetail,
  type InterviewQuestionItem,
  type InterviewTopicProgressItem,
  type ReviewAnswerInput,
  reviewAnswerSchema,
  type UpdateTopicProgressInput,
  updateTopicProgressSchema,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InterviewService } from './interview.service';

/** Interview-prep module (ADR-013): resume-driven plan, Q&A, live-coding review. */
@Controller('interview')
@UseGuards(AuthGuard)
export class InterviewController {
  constructor(private readonly interview: InterviewService) {}

  @Get('plan')
  getPlan(@CurrentUser() user: AuthUser): Promise<InterviewPlanDetail | null> {
    return this.interview.getActivePlan(user.id);
  }

  @Post('plan')
  generatePlan(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(generatePlanSchema)) body: GeneratePlanInput,
  ): Promise<InterviewPlanDetail> {
    return this.interview.generatePlan(user.id, body);
  }

  @Patch('plan/:id/progress')
  updateProgress(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTopicProgressSchema)) body: UpdateTopicProgressInput,
  ): Promise<InterviewTopicProgressItem> {
    return this.interview.updateProgress(user.id, id, body);
  }

  @Get('questions')
  listQuestions(
    @CurrentUser() user: AuthUser,
    @Query('topic') topic?: string,
    @Query('planId') planId?: string,
  ): Promise<InterviewQuestionItem[]> {
    return this.interview.listQuestions(user.id, { topic, planId });
  }

  @Post('questions')
  generateQuestions(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(generateQuestionsSchema)) body: GenerateQuestionsInput,
  ): Promise<InterviewQuestionItem[]> {
    return this.interview.generateQuestions(user.id, body);
  }

  @Post('questions/:id/model-answer')
  revealModelAnswer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InterviewModelAnswerResponse> {
    return this.interview.revealModelAnswer(user.id, id);
  }

  @Post('questions/:id/review')
  reviewAnswer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reviewAnswerSchema)) body: ReviewAnswerInput,
  ): Promise<InterviewAnswerReview> {
    return this.interview.reviewAnswer(user.id, id, body.answer);
  }
}
