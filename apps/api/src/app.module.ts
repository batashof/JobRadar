import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { ApplicationsModule } from './applications/applications.module';
import { AuthModule } from './auth/auth.module';
import { BotModule } from './bot/bot.module';
import { CandidateModule } from './candidate/candidate.module';
import { SettingsModule } from './settings/settings.module';
import { StatsModule } from './stats/stats.module';
import { TriageModule } from './triage/triage.module';
import { DbModule } from './db/db.module';
import { DigestModule } from './digest/digest.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { InterviewModule } from './interview/interview.module';
import { LlmModule } from './llm/llm.module';
import { MatchingModule } from './matching/matching.module';
import { OutreachModule } from './outreach/outreach.module';
import { PlannerModule } from './planner/planner.module';
import { ProfilesModule } from './profiles/profiles.module';
import { ResumesModule } from './resumes/resumes.module';
import { VacanciesModule } from './vacancies/vacancies.module';

@Module({
  imports: [
    // Sentry first so it can hook into the modules registered after it. A no-op
    // when SENTRY_DSN is unset (see instrument.ts).
    SentryModule.forRoot(),
    // Local dev reads the repo-root .env (resolved from the compiled file, so it
    // works regardless of cwd); hosted envs provide real env vars.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [join(__dirname, '../../../.env')] }),
    DbModule,
    HealthModule,
    AuthModule,
    BotModule,
    CandidateModule,
    SettingsModule,
    StatsModule,
    TriageModule,
    DigestModule,
    LlmModule,
    MatchingModule,
    InterviewModule,
    OutreachModule,
    PlannerModule,
    ProfilesModule,
    ResumesModule,
    VacanciesModule,
    ApplicationsModule,
    IngestionModule,
  ],
  providers: [
    // Reports unhandled exceptions from HTTP handlers to Sentry while preserving
    // Nest's default error responses. Inert when Sentry is disabled.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule {}
