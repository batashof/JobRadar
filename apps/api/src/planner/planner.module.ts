import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CandidatesService } from './candidates.service';
import { PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';

/**
 * Day planner (ADR-015). Increment 1 is deliberately LLM-free: candidates come
 * from plain SQL over existing app state and the plan is assembled by hand.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlannerController],
  providers: [PlannerService, CandidatesService],
})
export class PlannerModule {}
