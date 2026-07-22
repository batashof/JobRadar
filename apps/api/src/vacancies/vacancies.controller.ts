import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import {
  type AuthUser,
  type SourceOption,
  type VacancyDetail,
  type VacancyFeed,
  type VacancyQuery,
  vacancyQuerySchema,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { VacanciesService } from './vacancies.service';

@Controller('vacancies')
@UseGuards(AuthGuard)
export class VacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Get()
  feed(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(vacancyQuerySchema)) query: VacancyQuery,
  ): Promise<VacancyFeed> {
    return this.vacancies.feed(user.id, user.language, query);
  }

  @Get('sources')
  listSources(): Promise<SourceOption[]> {
    return this.vacancies.listSources();
  }

  // Declared after the static routes so 'sources' isn't swallowed by :id.
  @Get(':id')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VacancyDetail> {
    return this.vacancies.getById(user.id, user.language, id);
  }
}
