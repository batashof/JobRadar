import { Module } from '@nestjs/common';

import { BotModule } from '../bot/bot.module';
import { LlmModule } from '../llm/llm.module';
import { ResumesModule } from '../resumes/resumes.module';
import { CandidateBotService } from './candidate-bot.service';
import { CandidateService } from './candidate.service';

/**
 * Candidate profile (ADR-025): the resume, read once by the LLM at
 * registration, turned into the criteria rule-based matching uses. The bot is
 * its only surface (ADR-024).
 */
@Module({
  imports: [BotModule, LlmModule, ResumesModule],
  providers: [CandidateService, CandidateBotService],
  exports: [CandidateService],
})
export class CandidateModule {}
