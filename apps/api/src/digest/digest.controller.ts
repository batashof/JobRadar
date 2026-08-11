import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
  type AuthUser,
  type DigestRunResponse,
  type DigestSettings,
  type UpdateDigestSettingsInput,
  updateDigestSettingsSchema,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DigestSendService } from './digest-send.service';
import { DigestService } from './digest.service';

/** Daily vacancy digest: schedule configuration plus a manual send. */
@Controller('digest')
@UseGuards(AuthGuard)
export class DigestController {
  constructor(
    private readonly digest: DigestService,
    private readonly send: DigestSendService,
  ) {}

  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser): Promise<DigestSettings> {
    return this.digest.getSettings(user.id);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateDigestSettingsSchema)) input: UpdateDigestSettingsInput,
  ): Promise<DigestSettings> {
    return this.digest.updateSettings(user.id, input);
  }

  /**
   * Sends this user's digest right now, ignoring the schedule — the "try it"
   * button. It still consumes the vacancies it sends, so a manual run and the
   * next scheduled one never overlap.
   */
  @Post('run')
  async runNow(@CurrentUser() user: AuthUser): Promise<DigestRunResponse> {
    return { sent: await this.send.sendNow(user.id) };
  }
}
