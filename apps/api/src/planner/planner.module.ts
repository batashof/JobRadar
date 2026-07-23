import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { CandidatesService } from './candidates.service';
import { PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';

/**
 * Day planner (ADR-015). Candidates come from plain SQL over existing app
 * state; the LLM only selects and sequences them, with a deterministic
 * fallback so the module works without an API key.
 */
@Module({
  imports: [AuthModule, LlmModule],
  controllers: [PlannerController],
  providers: [PlannerService, CandidatesService],
})
export class PlannerModule {}
