import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { LlmModule } from '../llm/llm.module';
import { CandidatesService } from './candidates.service';
import { PlannerController } from './planner.controller';
import { PlannerScheduler } from './planner.scheduler';
import { PlannerService } from './planner.service';
import { PlannerBotService } from './planner-bot.service';
import { PlannerTickService } from './planner-tick.service';

/**
 * Day planner (ADR-015). Candidates come from plain SQL over existing app
 * state; the LLM only selects and sequences them, with a deterministic
 * fallback so the module works without an API key. `planner:tick` runs the
 * time-driven half on a plain in-process interval — no BullMQ/Redis (revised
 * ADR-015 §7), since the tick only touches Postgres and Redis polling was
 * burning the Upstash free-tier command budget.
 */
@Module({
  imports: [AuthModule, BotModule, LlmModule],
  controllers: [PlannerController],
  providers: [
    PlannerService,
    CandidatesService,
    PlannerBotService,
    PlannerTickService,
    PlannerScheduler,
  ],
})
export class PlannerModule {}
