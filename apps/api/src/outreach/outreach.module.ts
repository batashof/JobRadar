import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { LlmModule } from '../llm/llm.module';
import { ResumesModule } from '../resumes/resumes.module';
import { ChatApplyService } from './chat-apply.service';
import { GmailController } from './gmail.controller';
import { GmailService } from './gmail.service';
import { OutreachController } from './outreach.controller';
import { OutreachService } from './outreach.service';

/**
 * Applying: from the vacancy page (controllers) and from the Telegram chat
 * (`ChatApplyService`, registered under the `a:` callback namespace). Both go
 * through the same `OutreachService`, so an application sent from the phone
 * records outreach and moves the kanban exactly like one sent from the app.
 */
@Module({
  imports: [AuthModule, BotModule, LlmModule, ResumesModule],
  controllers: [OutreachController, GmailController],
  providers: [OutreachService, GmailService, ChatApplyService],
  exports: [OutreachService],
})
export class OutreachModule {}
