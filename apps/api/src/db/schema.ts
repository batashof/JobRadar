import { sql, type SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const workFormatEnum = pgEnum('work_format', ['remote', 'onsite', 'hybrid']);

export const employmentTypeEnum = pgEnum('employment_type', [
  'full_time',
  'part_time',
  'freelance',
]);

export const sourceKindEnum = pgEnum('source_kind', ['api', 'rss', 'telegram', 'manual']);

export const sourceRunStatusEnum = pgEnum('source_run_status', ['ok', 'empty', 'error']);

export const applicationStageEnum = pgEnum('application_stage', [
  'saved',
  'applied',
  'screening',
  'tech_interview',
  'offer',
  'rejected',
  'withdrawn',
]);

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  oauthProvider: text('oauth_provider'),
  oauthId: text('oauth_id'),
  digestEnabled: boolean('digest_enabled').notNull().default(true),
  digestLastSentAt: timestamp('digest_last_sent_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const searchProfiles = pgTable(
  'search_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
    stack: text('stack').array().notNull().default(sql`'{}'::text[]`),
    workFormat: workFormatEnum('work_format').array().notNull().default(sql`'{}'::work_format[]`),
    employmentType: employmentTypeEnum('employment_type')
      .array()
      .notNull()
      .default(sql`'{}'::employment_type[]`),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    salaryCurrency: text('salary_currency'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('search_profiles_user_id_idx').on(t.userId)],
);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  kind: sourceKindEnum('kind').notNull(),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: sourceRunStatusEnum('last_run_status'),
});

export const vacancies = pgTable(
  'vacancies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    companyRaw: text('company_raw').notNull(),
    companyNormalized: text('company_normalized').notNull(),
    description: text('description').notNull().default(''),
    // 'simple' config: sources mix Russian and English; no language-specific
    // stemming for v1 (revisit when relevance is tuned on real data).
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector('simple', coalesce(${vacancies.title}, '') || ' ' || coalesce(${vacancies.companyRaw}, '') || ' ' || coalesce(${vacancies.description}, ''))`,
    ),
    workFormat: workFormatEnum('work_format'),
    employmentType: employmentTypeEnum('employment_type'),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    salaryCurrency: text('salary_currency'),
    location: text('location'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
    canonicalVacancyId: uuid('canonical_vacancy_id').references(
      (): AnyPgColumn => vacancies.id,
      { onDelete: 'set null' },
    ),
  },
  (t) => [
    uniqueIndex('vacancies_source_external_idx').on(t.sourceId, t.externalId),
    index('vacancies_search_vector_idx').using('gin', t.searchVector),
    index('vacancies_company_normalized_idx').on(t.companyNormalized),
    index('vacancies_published_at_idx').on(t.publishedAt),
  ],
);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vacancyId: uuid('vacancy_id')
      .notNull()
      .references(() => vacancies.id),
    stage: applicationStageEnum('stage').notNull().default('saved'),
    stageOrder: integer('stage_order').notNull().default(0),
    notes: text('notes').notNull().default(''),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
    remindAfterDays: integer('remind_after_days'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('applications_user_vacancy_idx').on(t.userId, t.vacancyId)],
);

export const profileMatches = pgTable(
  'profile_matches',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => searchProfiles.id, { onDelete: 'cascade' }),
    vacancyId: uuid('vacancy_id')
      .notNull()
      .references(() => vacancies.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    matchedAt: timestamp('matched_at', { withTimezone: true }).defaultNow().notNull(),
    digestedAt: timestamp('digested_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.vacancyId] })],
);
