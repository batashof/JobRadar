import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { ResumesModule } from '../resumes/resumes.module';
import { GmailController } from './gmail.controller';
import { GmailService } from './gmail.service';
import { OutreachController } from './outreach.controller';
import { OutreachService } from './outreach.service';

@Module({
  imports: [AuthModule, LlmModule, ResumesModule],
  controllers: [OutreachController, GmailController],
  providers: [OutreachService, GmailService],
  exports: [OutreachService],
})
export class OutreachModule {}
