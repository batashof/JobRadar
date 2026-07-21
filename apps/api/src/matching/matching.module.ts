import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { MatchingService } from './matching.service';
import { ResumeMatchingService } from './resume-matching.service';

@Module({
  imports: [AuthModule, LlmModule],
  controllers: [MatchesController],
  providers: [MatchingService, MatchesService, ResumeMatchingService],
  exports: [MatchingService, ResumeMatchingService],
})
export class MatchingModule {}
