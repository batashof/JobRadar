import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type AddPlanBlockInput,
  addPlanBlockSchema,
  type AuthUser,
  type CreateDayPlanInput,
  createDayPlanSchema,
  type DayPlanDetail,
  type DropPlanBlockInput,
  dropPlanBlockSchema,
  type PlanCandidatesResponse,
  type PlannerSettings,
  type PlannerTodayResponse,
  type ReorderPlanBlocksInput,
  reorderPlanBlocksSchema,
  type UpdatePlanBlockInput,
  updatePlanBlockSchema,
  type UpdatePlannerSettingsInput,
  updatePlannerSettingsSchema,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PlannerService } from './planner.service';

/** Day planner (ADR-015). Increment 1: settings, candidates, manual plan. */
@Controller('planner')
@UseGuards(AuthGuard)
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @Get('today')
  getToday(@CurrentUser() user: AuthUser): Promise<PlannerTodayResponse> {
    return this.planner.getToday(user.id);
  }

  /** Candidate titles come back in the account language (ADR-014). */
  @Get('candidates')
  getCandidates(@CurrentUser() user: AuthUser): Promise<PlanCandidatesResponse> {
    return this.planner.getCandidates(user.id, user.language);
  }

  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser): Promise<PlannerSettings> {
    return this.planner.getSettings(user.id);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updatePlannerSettingsSchema)) body: UpdatePlannerSettingsInput,
  ): Promise<PlannerSettings> {
    return this.planner.updateSettings(user.id, body);
  }

  @Post('plans')
  createPlan(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDayPlanSchema)) body: CreateDayPlanInput,
  ): Promise<DayPlanDetail> {
    return this.planner.createPlan(user.id, body);
  }

  @Post('plans/:id/accept')
  acceptPlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DayPlanDetail> {
    return this.planner.acceptPlan(user.id, id);
  }

  @Patch('plans/:id')
  setIntent(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createDayPlanSchema)) body: CreateDayPlanInput,
  ): Promise<DayPlanDetail> {
    return this.planner.setIntent(user.id, id, body.intent ?? null);
  }

  @Post('plans/:id/reorder')
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reorderPlanBlocksSchema)) body: ReorderPlanBlocksInput,
  ): Promise<DayPlanDetail> {
    return this.planner.reorder(user.id, id, body);
  }

  @Post('blocks')
  addBlock(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(addPlanBlockSchema)) body: AddPlanBlockInput,
  ): Promise<DayPlanDetail> {
    return this.planner.addBlock(user.id, body);
  }

  @Patch('blocks/:id')
  updateBlock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePlanBlockSchema)) body: UpdatePlanBlockInput,
  ): Promise<DayPlanDetail> {
    return this.planner.updateBlock(user.id, id, body);
  }

  @Delete('blocks/:id')
  dropBlock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(dropPlanBlockSchema)) body: DropPlanBlockInput,
  ): Promise<DayPlanDetail> {
    return this.planner.dropBlock(user.id, id, body);
  }
}
