import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type ApplicationCreateInput,
  applicationCreateSchema,
  type ApplicationReorderInput,
  applicationReorderSchema,
  type ApplicationUpdateInput,
  applicationUpdateSchema,
  type AuthUser,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApplicationsService } from './applications.service';

@Controller('applications')
@UseGuards(AuthGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.applications.list(user.id);
  }

  /** Follow-up reminders: applications with no answer past their threshold. */
  @Get('reminders')
  listReminders(@CurrentUser() user: AuthUser) {
    return this.applications.listReminders(user.id);
  }

  /** Board totals + applied → offer funnel conversion. */
  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.applications.stats(user.id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(applicationCreateSchema)) body: ApplicationCreateInput,
  ) {
    return this.applications.create(user.id, body);
  }

  // Reorder must be matched before the ':id' routes below.
  @Post('reorder')
  @HttpCode(200)
  reorder(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(applicationReorderSchema)) body: ApplicationReorderInput,
  ) {
    return this.applications.reorder(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(applicationUpdateSchema)) body: ApplicationUpdateInput,
  ) {
    return this.applications.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.applications.remove(user.id, id);
  }
}
