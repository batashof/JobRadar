import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { CandidatesService } from './candidates.service';
import { PlannerController } from './planner.controller';
import { PlannerProcessor, PlannerScheduler, PLANNER_QUEUE } from './planner.processor';
import { PlannerService } from './planner.service';
import { PlannerTickService } from './planner-tick.service';

/**
 * Day planner (ADR-015). Candidates come from plain SQL over existing app
 * state; the LLM only selects and sequences them, with a deterministic
 * fallback so the module works without an API key. `planner:tick` runs the
 * time-driven half in-process every minute (ADR-015 §7).
 */
@Module({
  imports: [AuthModule, LlmModule, BullModule.registerQueue({ name: PLANNER_QUEUE })],
  controllers: [PlannerController],
  providers: [
    PlannerService,
    CandidatesService,
    PlannerTickService,
    PlannerProcessor,
    PlannerScheduler,
  ],
})
export class PlannerModule {}
