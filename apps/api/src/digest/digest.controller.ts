import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  type AuthUser,
  type DigestSettings,
  type UpdateDigestSettingsInput,
  updateDigestSettingsSchema,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DigestService } from './digest.service';

/** Daily vacancy digest — configuration only for now; sending lands next. */
@Controller('digest')
@UseGuards(AuthGuard)
export class DigestController {
  constructor(private readonly digest: DigestService) {}

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
}
