import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { LlmModule } from '../llm/llm.module';
import { ResumesModule } from '../resumes/resumes.module';
import { InterviewBotService } from './interview-bot.service';
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';

/**
 * Interview-prep module (ADR-013). Reuses the LLM gateway and resumes; the
 * REST API served the web pages, `/interview` in the bot serves the owner
 * (roadmap 5.5, ADR-024 §3).
 */
@Module({
  imports: [AuthModule, BotModule, LlmModule, ResumesModule],
  controllers: [InterviewController],
  providers: [InterviewService, InterviewBotService],
})
export class InterviewModule {}
