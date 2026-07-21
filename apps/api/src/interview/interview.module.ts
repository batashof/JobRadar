import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { ResumesModule } from '../resumes/resumes.module';
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';

/** Interview-prep module (ADR-013). Reuses the LLM gateway and resumes. */
@Module({
  imports: [AuthModule, LlmModule, ResumesModule],
  controllers: [InterviewController],
  providers: [InterviewService],
})
export class InterviewModule {}
