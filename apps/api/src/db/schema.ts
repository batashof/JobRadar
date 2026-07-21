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
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { InterviewPlanStructure, InterviewReview } from '@jobradar/shared';

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

// Interview-prep module (ADR-013).
export const interviewTopicStatusEnum = pgEnum('interview_topic_status', [
  'todo',
  'in_progress',
  'done',
]);

export const interviewQuestionKindEnum = pgEnum('interview_question_kind', [
  'theory',
  'behavioral',
  'coding',
]);

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
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
  // OAuth refresh token for the Gmail `gmail.send` scope (ADR-011).
  // Null = email apply disabled. Encrypted at rest by the app layer.
  gmailRefreshToken: text('gmail_refresh_token'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Opaque high-entropy token stored in the client's httpOnly cookie.
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

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
    // Application contact extracted from the description (ADR-011):
    // { kind: 'email' | 'telegram' | 'url', value: string }
    applyContact: jsonb('apply_contact').$type<{ kind: string; value: string } | null>(),
    // Coarse level detected at ingestion for the resume-driven feed filter
    // (ADR-012): 'intern' | 'junior' | 'middle' | 'senior' | 'lead' | null.
    seniority: text('seniority'),
    // On-demand Russian brief, cached after the first generation (ADR-011).
    summaryRu: text('summary_ru'),
    summaryGeneratedAt: timestamp('summary_generated_at', { withTimezone: true }),
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
    // Furthest non-terminal stage ever reached — survives rejected/withdrawn
    // moves so the funnel keeps counting them (never terminal by invariant).
    furthestStage: applicationStageEnum('furthest_stage').notNull().default('saved'),
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

export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    // The PDF itself. Postgres storage is fine at single-user scale (ADR-011).
    file: bytea('file').notNull(),
    // Extracted at upload; the only thing LLM prompts consume.
    extractedText: text('extracted_text').notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('resumes_user_id_idx').on(t.userId)],
);

// LLM resume <-> vacancy matching cache: permanent, one row per resume x vacancy
// (token discipline, ADR-005 / ADR-011).
export const resumeMatches = pgTable(
  'resume_matches',
  {
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resumes.id, { onDelete: 'cascade' }),
    vacancyId: uuid('vacancy_id')
      .notNull()
      .references(() => vacancies.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    explanation: text('explanation').notNull().default(''),
    matchedAt: timestamp('matched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.resumeId, t.vacancyId] })],
);

// Sent application emails (ADR-011). A row is written only after Gmail accepts
// the message; drafts live client-side until the user confirms the send.
export const outreachEmails = pgTable(
  'outreach_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vacancyId: uuid('vacancy_id')
      .notNull()
      .references(() => vacancies.id),
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resumes.id),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    gmailMessageId: text('gmail_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('outreach_emails_user_id_idx').on(t.userId)],
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

// ---------------------------------------------------------------------------
// Interview-prep module (ADR-013)
// ---------------------------------------------------------------------------

// A resume-driven study roadmap. One active plan per user; older ones are kept
// as history. `resume_id` is nullable + set-null so deleting the source resume
// does not take the plan with it.
export const interviewPlans = pgTable(
  'interview_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    targetRole: text('target_role'),
    targetSeniority: text('target_seniority'),
    focus: text('focus').array().notNull().default(sql`'{}'::text[]`),
    // LLM plan: { sections: [{ title, topics: [{ key, title, why }] }] }.
    structure: jsonb('structure').notNull().$type<InterviewPlanStructure>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('interview_plans_user_id_idx').on(t.userId)],
);

// Per-topic progress, kept out of the plan's `structure` so the plan stays
// stable and progress is queryable. `topic_key` matches a topics[].key.
export const interviewTopicProgress = pgTable(
  'interview_topic_progress',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => interviewPlans.id, { onDelete: 'cascade' }),
    topicKey: text('topic_key').notNull(),
    status: interviewTopicStatusEnum('status').notNull().default('todo'),
    confidence: smallint('confidence'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.topicKey] })],
);

// Generated, cached questions and live-coding tasks. The model answer is
// generated only when the user reveals it (extra token discipline, ADR-005).
export const interviewQuestions = pgTable(
  'interview_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => interviewPlans.id, { onDelete: 'set null' }),
    topic: text('topic').notNull(),
    kind: interviewQuestionKindEnum('kind').notNull(),
    difficulty: text('difficulty'),
    prompt: text('prompt').notNull(),
    modelAnswer: text('model_answer'),
    createdAt: createdAt(),
  },
  (t) => [index('interview_questions_user_id_idx').on(t.userId)],
);

// A user attempt (written answer or pasted live-coding solution) and its LLM
// review. The code is reviewed, never executed (ADR-013).
export const interviewAnswers = pgTable(
  'interview_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => interviewQuestions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    answer: text('answer').notNull(),
    review: jsonb('review').$type<InterviewReview>(),
    score: real('score'),
    createdAt: createdAt(),
  },
  (t) => [index('interview_answers_question_id_idx').on(t.questionId)],
);
