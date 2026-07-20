import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  type SourceOption,
  type VacancyFeed,
  type VacancyQuery,
  vacancyQuerySchema,
} from '@jobradar/shared';

import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { VacanciesService } from './vacancies.service';

@Controller('vacancies')
@UseGuards(AuthGuard)
export class VacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Get()
  feed(
    @Query(new ZodValidationPipe(vacancyQuerySchema)) query: VacancyQuery,
  ): Promise<VacancyFeed> {
    return this.vacancies.feed(query);
  }

  @Get('sources')
  listSources(): Promise<SourceOption[]> {
    return this.vacancies.listSources();
  }
}
