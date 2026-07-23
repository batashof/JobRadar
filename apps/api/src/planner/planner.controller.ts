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
  type CloseDayPlanInput,
  closeDayPlanSchema,
  type CompletePlanBlockInput,
  completePlanBlockSchema,
  type CreateDayPlanInput,
  createDayPlanSchema,
  type DayPlanDetail,
  type DropPlanBlockInput,
  dropPlanBlockSchema,
  type GenerateDayPlanInput,
  generateDayPlanSchema,
  type PlanCandidatesResponse,
  type PlannerNudgeItem,
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

  @Get('nudges')
  getNudges(@CurrentUser() user: AuthUser): Promise<PlannerNudgeItem[]> {
    return this.planner.listNudges(user.id);
  }

  @Post('nudges/:id/ack')
  acknowledgeNudge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlannerNudgeItem[]> {
    return this.planner.acknowledgeNudge(user.id, id);
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

  /** Composes the day from candidates; titles follow the account language. */
  @Post('plans/generate')
  generatePlan(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(generateDayPlanSchema)) body: GenerateDayPlanInput,
  ): Promise<DayPlanDetail> {
    return this.planner.generatePlan(user.id, user.language, body);
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

  @Post('plans/:id/close')
  closePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(closeDayPlanSchema)) body: CloseDayPlanInput,
  ): Promise<DayPlanDetail> {
    return this.planner.closePlan(user.id, id, body);
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

  @Post('blocks/:id/start')
  startBlock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DayPlanDetail> {
    return this.planner.startBlock(user.id, id);
  }

  @Post('blocks/:id/pause')
  pauseBlock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DayPlanDetail> {
    return this.planner.pauseBlock(user.id, id);
  }

  @Post('blocks/:id/complete')
  completeBlock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(completePlanBlockSchema)) body: CompletePlanBlockInput,
  ): Promise<DayPlanDetail> {
    return this.planner.completeBlock(user.id, id, body);
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
