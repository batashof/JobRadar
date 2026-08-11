import { sql, type SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  DayPlanReview,
  InterviewFeedback,
  InterviewPlanStructure,
  InterviewReview,
  InterviewTurn,
  PlanBlockCategory,
  PlanBlockSourceRef,
  ResumeMatchDimension,
} from '@jobradar/shared';

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

export const interviewSessionStatusEnum = pgEnum('interview_session_status', [
  'in_progress',
  'completed',
  'abandoned',
]);

// Day planner (ADR-015).
export const dayPlanStatusEnum = pgEnum('day_plan_status', ['draft', 'accepted', 'closed']);

export const dayPlanGeneratorEnum = pgEnum('day_plan_generator', ['manual', 'llm', 'fallback']);

export const planBlockCategoryEnum = pgEnum('plan_block_category', [
  'job_search',
  'interview_prep',
  'learning',
  'admin',
  'other',
]);

// Named `plan_block_source` — `source_kind` is already taken by `sources.kind`.
export const planBlockSourceEnum = pgEnum('plan_block_source', [
  'manual',
  'application_followup',
  'interview_topic',
  'vacancy_apply',
  'course',
  'debt',
]);

export const planBlockStatusEnum = pgEnum('plan_block_status', [
  'pending',
  'active',
  'done',
  'partial',
  'skipped',
  'dropped',
]);

export const planSkipReasonEnum = pgEnum('plan_skip_reason', [
  'no_time',
  'no_energy',
  'blocked',
  'changed_priority',
  'avoided',
  'unreported',
]);

export const focusSessionEndEnum = pgEnum('focus_session_end', [
  'completed',
  'paused',
  'abandoned',
  'auto',
]);

export const plannerNudgeKindEnum = pgEnum('planner_nudge_kind', [
  'morning',
  'block_start',
  'midway',
  'evening',
  'escalation',
  'debt',
]);

export const plannerNudgeChannelEnum = pgEnum('planner_nudge_channel', ['telegram', 'in_app']);

export const plannerNudgeStatusEnum = pgEnum('planner_nudge_status', [
  'pending',
  'sent',
  'acknowledged',
  'ignored',
  'cancelled',
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
  // Interface + AI-generation language, 'en' | 'ru' (ADR-014). Default 'ru'.
  language: text('language').notNull().default('ru'),
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
    // On-demand brief, cached per language after the first generation
    // (ADR-011/014). One slot per interface language, shared across users.
    summaryRu: text('summary_ru'),
    summaryGeneratedAt: timestamp('summary_generated_at', { withTimezone: true }),
    summaryEn: text('summary_en'),
    summaryEnGeneratedAt: timestamp('summary_en_generated_at', { withTimezone: true }),
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
    // Rationale cached per interface language (ADR-014). `explanation` is the
    // Russian slot (legacy name kept); `explanation_en` the English one. The
    // score itself is language-neutral and generated once.
    explanation: text('explanation').notNull().default(''),
    explanationEn: text('explanation_en').notNull().default(''),
    // Per-criterion breakdown cached per language (ADR-012); null for rows
    // scored before the breakdown existed. Dimension scores are language-neutral.
    breakdown: jsonb('breakdown').$type<ResumeMatchDimension[]>(),
    breakdownEn: jsonb('breakdown_en').$type<ResumeMatchDimension[]>(),
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

// An application drafted in the Telegram chat, waiting for the user to confirm
// it. The text has to survive between the draft message and the confirm press:
// re-generating on confirm would send something other than what was reviewed.
export const applyDrafts = pgTable(
  'apply_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vacancyId: uuid('vacancy_id')
      .notNull()
      .references(() => vacancies.id, { onDelete: 'cascade' }),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    // Set once the draft has been sent, so a second press cannot send twice.
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('apply_drafts_user_id_idx').on(t.userId)],
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

// Vacancies the user manually hid from the feed. Excluded by default; the
// "show hidden" toggle brings them back. A plain per-user mute list.
export const hiddenVacancies = pgTable(
  'hidden_vacancies',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vacancyId: uuid('vacancy_id')
      .notNull()
      .references(() => vacancies.id, { onDelete: 'cascade' }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.vacancyId] })],
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

// A text-chat mock interview and its final feedback report (ADR-013). The
// interviewer is the LLM; `transcript` holds the turn-by-turn conversation.
export const interviewSessions = pgTable(
  'interview_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => interviewPlans.id, { onDelete: 'set null' }),
    targetRole: text('target_role'),
    targetSeniority: text('target_seniority'),
    status: interviewSessionStatusEnum('status').notNull().default('in_progress'),
    transcript: jsonb('transcript')
      .notNull()
      .$type<InterviewTurn[]>()
      .default(sql`'[]'::jsonb`),
    feedback: jsonb('feedback').$type<InterviewFeedback>(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('interview_sessions_user_id_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Telegram bot channel (Bot API — not the MTProto ingestion client of ADR-009)
// ---------------------------------------------------------------------------

// One chat per account, shared by every feature that pushes to the phone
// (planner nudges, vacancy digest). A row exists as soon as a link is started;
// `chat_id` stays null until the user opens the deep link and the bot receives
// `/start <token>`.
export const telegramAccounts = pgTable(
  'telegram_accounts',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: text('chat_id'),
    username: text('username'),
    // Single-use, short-lived deep-link token; cleared once the link completes.
    linkToken: text('link_token'),
    linkTokenExpiresAt: timestamp('link_token_expires_at', { withTimezone: true }),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A chat can drive at most one account, and a token resolves to one row.
    uniqueIndex('telegram_accounts_chat_id_idx').on(t.chatId),
    uniqueIndex('telegram_accounts_link_token_idx').on(t.linkToken),
  ],
);

// ---------------------------------------------------------------------------
// Daily vacancy digest (delivered over the bot channel above)
// ---------------------------------------------------------------------------

// One row per user, created lazily with defaults on first read. The wall-clock
// times are resolved in `planner_settings.timezone` — per-user state that
// already exists; a second copy here would drift.
export const digestSettings = pgTable('digest_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  // `HH:MM` local times, sorted; one row per push, at most four a day.
  sendTimes: text('send_times').array().notNull().default(['09:00']),
  maxItems: smallint('max_items').notNull().default(10),
  // Resume-fit floor in percent; below it a vacancy is not worth a push.
  minScore: smallint('min_score').notNull().default(60),
  // Delivery bookkeeping, not configuration: `YYYY-MM-DD HH:MM` of the last
  // consumed slot. The scheduler compares the due slot against it, so a restart
  // (or a minute-granularity tick) can never send the same slot twice.
  lastSentKey: text('last_sent_key'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One row per vacancy ever pushed to a user — the guarantee that a digest never
// repeats itself, and where the 👍/👎 feedback lands (it feeds future ranking).
export const digestItems = pgTable(
  'digest_items',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vacancyId: uuid('vacancy_id')
      .notNull()
      .references(() => vacancies.id, { onDelete: 'cascade' }),
    // Fit score at send time, 0..100; the ranking is not re-derivable later.
    score: smallint('score').notNull(),
    // `YYYY-MM-DD HH:MM` of the send this vacancy went out in.
    slotKey: text('slot_key').notNull(),
    // Telegram message id, so a button press can rewrite its own card.
    messageId: text('message_id'),
    // +1 / -1 from the thumb buttons; null = no verdict yet.
    feedback: smallint('feedback'),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.vacancyId] }),
    index('digest_items_user_sent_idx').on(t.userId, t.sentAt),
  ],
);

// ---------------------------------------------------------------------------
// Day planner (ADR-015)
// ---------------------------------------------------------------------------

// Per-user planner configuration. Created lazily with defaults on first use;
// `timezone` is what makes "today" and the ritual times well-defined.
export const plannerSettings = pgTable('planner_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('UTC'),
  morningRitualAt: time('morning_ritual_at').notNull().default('09:00'),
  eveningReviewAt: time('evening_review_at').notNull().default('20:00'),
  capacityMinutes: integer('capacity_minutes').notNull().default(240),
  defaultBlockMinutes: integer('default_block_minutes').notNull().default(30),
  // Soft weekly minutes per category: { "job_search": 300, ... }.
  categoryTargets: jsonb('category_targets').$type<Partial<Record<PlanBlockCategory, number>>>(),
  // Per-feature opt-in for the bot channel (ADR-015 §6). The chat itself lives
  // in `telegram_accounts` — one link per user, shared with the digest.
  telegramEnabled: boolean('telegram_enabled').notNull().default(false),
  escalationAfterMinutes: integer('escalation_after_minutes').notNull().default(20),
  escalationMaxRepeats: smallint('escalation_max_repeats').notNull().default(2),
  // Cached median actual/estimate, recomputed at day close. 1 = no correction.
  estimationFactor: real('estimation_factor').notNull().default(1),
  estimationFactorByCategory: jsonb('estimation_factor_by_category').$type<
    Partial<Record<PlanBlockCategory, number>>
  >(),
  updatedAt: updatedAt(),
});

// One plan per user per local day. `accepted_at` null = the morning ritual was
// never completed, and the day counts as unplanned in the stats.
export const dayPlans = pgTable(
  'day_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Local day in planner_settings.timezone, not a UTC instant.
    planDate: date('plan_date').notNull(),
    status: dayPlanStatusEnum('status').notNull().default('draft'),
    generatedBy: dayPlanGeneratorEnum('generated_by').notNull().default('manual'),
    intent: text('intent'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // True when the tick job closed the day instead of the user.
    autoClosed: boolean('auto_closed').notNull().default(false),
    review: jsonb('review').$type<DayPlanReview>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('day_plans_user_date_idx').on(t.userId, t.planDate)],
);

// One timebox in the day's queue. Ordered by `position`, never by wall clock —
// the current block is the first non-terminal one (ADR-015 §1).
export const planBlocks = pgTable(
  'plan_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => dayPlans.id, { onDelete: 'cascade' }),
    // Denormalized for user-scoped queries (debt lookups span plans).
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    details: text('details'),
    category: planBlockCategoryEnum('category').notNull().default('other'),
    sourceKind: planBlockSourceEnum('source_kind').notNull().default('manual'),
    // Backlink into the app: { applicationId } / { vacancyId } / { interviewPlanId, topicKey }.
    sourceRef: jsonb('source_ref').$type<PlanBlockSourceRef>(),
    estimateMinutes: integer('estimate_minutes').notNull().default(30),
    // estimate x the estimation factor at insert time; capacity is checked
    // against this, which is what stops the plan being a fantasy list.
    correctedEstimateMinutes: integer('corrected_estimate_minutes').notNull().default(30),
    actualMinutes: integer('actual_minutes').notNull().default(0),
    status: planBlockStatusEnum('status').notNull().default('pending'),
    skipReason: planSkipReasonEnum('skip_reason'),
    outcomeNote: text('outcome_note'),
    // Debt chain: the unfinished block this one was carried from.
    carriedFromBlockId: uuid('carried_from_block_id').references(
      (): AnyPgColumn => planBlocks.id,
      { onDelete: 'set null' },
    ),
    carryCount: smallint('carry_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('plan_blocks_plan_position_idx').on(t.planId, t.position),
    index('plan_blocks_user_status_idx').on(t.userId, t.status),
  ],
);

// One start->stop run of the focus timer. Pausing ends a session; resuming
// opens the next one. At most one row per user has `ended_at` null.
export const focusSessions = pgTable(
  'focus_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockId: uuid('block_id')
      .notNull()
      .references(() => planBlocks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    endedReason: focusSessionEndEnum('ended_reason'),
  },
  (t) => [index('focus_sessions_user_ended_idx').on(t.userId, t.endedAt)],
);

// Scheduled reminders. The tick job claims a row before sending, which is what
// makes delivery idempotent across restarts (ADR-015 §7).
export const plannerNudges = pgTable(
  'planner_nudges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => dayPlans.id, { onDelete: 'cascade' }),
    blockId: uuid('block_id').references(() => planBlocks.id, { onDelete: 'cascade' }),
    kind: plannerNudgeKindEnum('kind').notNull(),
    channel: plannerNudgeChannelEnum('channel').notNull().default('in_app'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    status: plannerNudgeStatusEnum('status').notNull().default('pending'),
    repeatIndex: smallint('repeat_index').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    telegramMessageId: text('telegram_message_id'),
    createdAt: createdAt(),
  },
  (t) => [index('planner_nudges_due_idx').on(t.status, t.scheduledFor)],
);
