# Data Model

> Status: **implemented** (ADR-008: Drizzle). Source of truth in code: `apps/api/src/db/schema.ts`; migrations in `apps/api/drizzle/`. Keep this file in sync with the schema.
> FTS note: `search_vector` uses the `simple` text-search config (sources mix Russian and English; no language-specific stemming in v1 — revisit when tuning relevance on real data).

## Entity overview

```
User 1──n Session
User 1──n SearchProfile
User 1──n Application n──1 Vacancy
Vacancy n──1 Source
Vacancy n──n Vacancy          (duplicate links)
SearchProfile n──n Vacancy    (matches, materialized)

Phase 4 (ADR-011):
User 1──n Resume
Resume n──n Vacancy           (resume_matches, LLM-scored, cached)
User 1──n OutreachEmail n──1 Vacancy

Phase 4 (ADR-013 — interview prep):
User 1──n InterviewPlan n──1 Resume
InterviewPlan 1──n InterviewTopicProgress
User 1──n InterviewQuestion (n──1 InterviewPlan, nullable)
InterviewQuestion 1──n InterviewAnswer
User 1──n InterviewSession (n──1 InterviewPlan, nullable)

Phase 4 (ADR-015 — day planner):
User 1──1 PlannerSettings
User 1──n DayPlan            (unique per day)
DayPlan 1──n PlanBlock
PlanBlock 1──n FocusSession
PlanBlock 0──1 PlanBlock      (carried_from — debt chain)
User 1──n PlannerNudge        (n──1 DayPlan / PlanBlock, nullable)
```

## Tables

### users

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | text unique | |
| password_hash | text nullable | null when OAuth-only |
| oauth_provider | text nullable | `github` / `google` |
| oauth_id | text nullable | |
| digest_enabled | boolean default true | unsubscribe flag |
| digest_last_sent_at | timestamptz nullable | idempotency for digest job |
| language | text not null default `'ru'` | interface + AI-generation language, `en` \| `ru` (ADR-014) |
| created_at / updated_at | timestamptz | |

### sessions

Server-side sessions for email+password auth (opaque token in an httpOnly cookie; revocable on logout).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| token | text unique | 256-bit opaque token stored in the client cookie |
| user_id | uuid FK → users | cascade on user delete |
| expires_at | timestamptz | validity checked on every guarded request |
| created_at | timestamptz | |

Index: `(user_id)`.

### search_profiles

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| name | text | e.g. "Senior React remote" |
| keywords | text[] | matched against title/description |
| stack | text[] | normalized tech tags |
| work_format | enum[] | `remote` / `onsite` / `hybrid` |
| employment_type | enum[] | `full_time` / `part_time` / `freelance` |
| salary_min / salary_max | integer nullable | |
| salary_currency | text nullable | ISO 4217 |
| is_active | boolean default true | |
| created_at / updated_at | timestamptz | |

### sources

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| slug | text unique | `hh`, `remoteok`, `weworkremotely`, ... |
| kind | enum | `api` / `rss` / `telegram` / `manual` |
| config | jsonb | endpoint, feed URL, fetch interval |
| is_active | boolean | |
| last_run_at | timestamptz nullable | |
| last_run_status | enum nullable | `ok` / `empty` / `error` — `empty` triggers Sentry alert |

### vacancies

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| source_id | uuid FK → sources | |
| external_id | text | id in the source system; **unique (source_id, external_id)** |
| url | text | canonical link |
| title | text | |
| company_raw | text | as received |
| company_normalized | text | lowercased, legal suffixes stripped — dedup key part |
| description | text | plain text / sanitized HTML |
| search_vector | tsvector | generated column for Postgres FTS (title + company + description) |
| work_format | enum nullable | |
| employment_type | enum nullable | |
| salary_min / salary_max / salary_currency | see profiles | parsed when available |
| location | text nullable | |
| published_at | timestamptz nullable | from source |
| ingested_at | timestamptz | |
| canonical_vacancy_id | uuid FK → vacancies, nullable | set on duplicates; null = canonical |

Indexes: `(source_id, external_id)` unique; GIN on `search_vector`; `(company_normalized)`; `(published_at)`.

### applications

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| vacancy_id | uuid FK → vacancies | |
| stage | enum | `saved` / `applied` / `screening` / `tech_interview` / `offer` (+ terminal: `rejected`, `withdrawn`) |
| stage_order | integer | manual ordering within a kanban column |
| notes | text | free-form, per-company/application notes |
| applied_at | timestamptz nullable | |
| last_activity_at | timestamptz | drives "no answer for N days" reminders |
| remind_after_days | integer nullable | per-application override |
| created_at / updated_at | timestamptz | |

Constraint: unique `(user_id, vacancy_id)`.

### profile_matches (materialized matching results)

| Column | Type | Notes |
|---|---|---|
| profile_id | uuid FK → search_profiles | |
| vacancy_id | uuid FK → vacancies | |
| score | real | rules-based in v1; LLM score in phase 4 |
| matched_at | timestamptz | |
| digested_at | timestamptz nullable | null = not yet included in a digest |

PK `(profile_id, vacancy_id)`.

## Phase 4 additions (ADR-011)

> Schema shipped (migration `0002`); features land incrementally on top of it.

### resumes

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| filename | text | original upload name |
| file | bytea | the PDF itself; Postgres storage is fine for a single user (ADR-011) |
| extracted_text | text | server-side extraction at upload; the only thing LLM prompts consume |
| is_active | boolean default true | the resume used for matching / applications |
| uploaded_at | timestamptz | |

### resume_matches (LLM matching cache)

| Column | Type | Notes |
|---|---|---|
| resume_id | uuid FK → resumes | |
| vacancy_id | uuid FK → vacancies | |
| score | real | LLM fit score (language-neutral, generated once) |
| explanation | text | short LLM fit explanation in Russian (ADR-014) |
| explanation_en | text not null default `''` | short LLM fit explanation in English (ADR-014) |
| matched_at | timestamptz | |

PK `(resume_id, vacancy_id)`. Rows are permanent (a vacancy is LLM-scored at most once per resume — token discipline, ADR-005). The score is generated once; each language's `explanation` is filled on first request in that language (ADR-014). Populated two ways: the capped background batch over profile-matched vacancies (ADR-011), and on-demand when the user scores a single vacancy from its detail page (ADR-012).

### outreach_emails (sent applications)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| vacancy_id | uuid FK → vacancies | |
| resume_id | uuid FK → resumes | attached PDF |
| recipient | text | pre-filled from `vacancies.apply_contact`, user-editable |
| subject | text | LLM-generated, user-editable |
| body | text | LLM-generated email body incl. cover letter, user-edited final version |
| gmail_message_id | text nullable | from the Gmail API response |
| sent_at | timestamptz | |

### New columns on existing tables

| Table | Column | Type | Notes |
|---|---|---|---|
| vacancies | apply_contact | jsonb nullable | extracted at ingestion: `{ "kind": "email" \| "telegram" \| "url", "value": ... }` |
| vacancies | seniority | text nullable | coarse level detected at ingestion (ADR-012): `intern \| junior \| middle \| senior \| lead`; null = unstated. Powers the feed's soft resume-driven level filter |
| vacancies | summary_ru | text nullable | cached on-demand Russian brief (employer, what they do, fit) |
| vacancies | summary_generated_at | timestamptz nullable | |
| vacancies | summary_en | text nullable | cached on-demand English brief; per-language slot (ADR-014) |
| vacancies | summary_en_generated_at | timestamptz nullable | |
| users | gmail_refresh_token | text nullable | OAuth refresh token for `gmail.send` (encrypted at rest); null = email apply disabled |

## Phase 4 additions (ADR-013 — interview prep)

> Shipped: `interview_plans`, `interview_topic_progress`, `interview_questions`, `interview_answers` (migration `0005`, v1.3.0); `interview_sessions` (migration `0006`, v1.4.0 — mock interview). Standalone, resume-driven; all content is LLM-generated on-demand and cached (ADR-005 discipline). No code execution, no voice (ADR-013).

### interview_plans

A resume-driven study roadmap. One active plan per user; older ones kept as history.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| resume_id | uuid FK → resumes, nullable | the resume the plan was generated from; `set null` on resume delete so the plan survives |
| target_role | text nullable | e.g. "Senior Frontend" |
| target_seniority | text nullable | `intern \| junior \| middle \| senior \| lead` |
| focus | text[] nullable | stack / areas to emphasise |
| structure | jsonb | LLM plan: `sections[]` → `topics[]`, each topic `{ key, title, why }`; `key` is stable and referenced by progress/questions |
| is_active | boolean default true | the current plan |
| created_at / updated_at | timestamptz | |

Index: `(user_id, is_active)`.

### interview_topic_progress

Per-topic progress within a plan (kept out of `structure` so the plan stays stable and progress is queryable).

| Column | Type | Notes |
|---|---|---|
| plan_id | uuid FK → interview_plans | cascade on plan delete |
| topic_key | text | matches a `topics[].key` in the plan's `structure` |
| status | enum | `todo` / `in_progress` / `done` |
| confidence | smallint nullable | user self-rating 1–5 |
| updated_at | timestamptz | |

PK `(plan_id, topic_key)`.

### interview_questions

Generated, cached questions and coding tasks.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| plan_id | uuid FK → interview_plans, nullable | topic context; null = ad-hoc |
| topic | text | topic label (usually a plan `topic_key`/title) |
| kind | enum | `theory` / `behavioral` / `coding` |
| difficulty | text nullable | `junior` / `middle` / `senior` |
| prompt | text | the question or live-coding task statement |
| model_answer | text nullable | reference answer — generated only when the user reveals it, then cached |
| created_at | timestamptz | |

### interview_answers

A user attempt (written answer or pasted live-coding solution) and its LLM review.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| question_id | uuid FK → interview_questions | |
| user_id | uuid FK → users | |
| answer | text | the user's written answer / submitted solution (code is reviewed, not executed) |
| review | jsonb | structured LLM feedback: correctness, complexity, edge cases, style, suggestions |
| score | real nullable | LLM score |
| created_at | timestamptz | |

### interview_sessions

A text-chat mock interview and its final feedback report.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| plan_id | uuid FK → interview_plans, nullable | |
| target_role | text nullable | |
| target_seniority | text nullable | |
| status | enum | `in_progress` / `completed` / `abandoned` |
| transcript | jsonb | ordered turns: `{ role: "interviewer" \| "candidate", content, at }` |
| feedback | jsonb nullable | final report: strengths, gaps, per-area notes, recommendation |
| started_at | timestamptz | |
| ended_at | timestamptz nullable | |

## Phase 4 additions (ADR-015 — day planner)

> Shipped: migration `0008` (v1.7.0 increment 1; v1.8.0 increment 2 started writing `focus_sessions`, block outcomes and `day_plans.review`). `planner_nudges` started being written in v1.10.0 by `planner:tick` (in-app channel; `telegram_message_id` stays null until the bot lands). One plan per user per day; blocks are an ordered queue (no wall-clock slots). All timestamps are `timestamptz`; day boundaries are resolved in `planner_settings.timezone`.

### planner_settings

One row per user; created lazily with defaults on first planner use.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK FK → users | cascade on user delete |
| timezone | text not null default `'UTC'` | IANA name; defines what "today" and the ritual times mean |
| morning_ritual_at | time not null default `09:00` | when the draft plan is generated and the morning nudge fires |
| evening_review_at | time not null default `20:00` | when the close-out reminder fires |
| capacity_minutes | integer not null default 240 | daily budget the planner fits blocks into (corrected estimates) |
| default_block_minutes | integer not null default 30 | |
| category_targets | jsonb nullable | soft weekly minutes per category, e.g. `{ "job_search": 300, "learning": 240 }` |
| telegram_chat_id | text nullable | null = nudges are in-app only |
| telegram_enabled | boolean not null default false | |
| escalation_after_minutes | integer not null default 20 | unacknowledged nudge → repeat |
| escalation_max_repeats | smallint not null default 2 | then the nudge is recorded as ignored |
| estimation_factor | real not null default 1 | cached median `actual / estimate`, recomputed at day close |
| estimation_factor_by_category | jsonb nullable | same, per category |
| updated_at | timestamptz | |

### day_plans

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| plan_date | date | the local day in the user's timezone; **unique (user_id, plan_date)** |
| status | enum | `draft` / `accepted` / `closed` |
| generated_by | enum | `llm` / `fallback` / `manual` — `fallback` = deterministic ordering when the LLM gateway was unavailable |
| intent | text nullable | one line: what today is actually about |
| accepted_at | timestamptz nullable | null = the ritual was never completed; the day counts as unplanned |
| closed_at | timestamptz nullable | |
| auto_closed | boolean not null default false | true when the tick job closed the day instead of the user |
| review | jsonb nullable | close-out summary: totals, per-category minutes, completion rate, debt created |
| created_at / updated_at | timestamptz | |

Index: `(user_id, plan_date)` unique.

### plan_blocks

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| plan_id | uuid FK → day_plans | cascade on plan delete |
| user_id | uuid FK → users | denormalized for user-scoped queries |
| position | integer | order in the queue; the "current" block is the first non-terminal one |
| title | text | |
| details | text nullable | what "done" means for this block |
| category | enum | `job_search` / `interview_prep` / `learning` / `admin` / `other` |
| source_kind | enum | `manual` / `application_followup` / `interview_topic` / `vacancy_apply` / `course` / `debt` |
| source_ref | jsonb nullable | `{ "applicationId": … }` / `{ "planId": …, "topicKey": … }` / `{ "vacancyId": … }` — lets the block deep-link into the app |
| estimate_minutes | integer | as entered / generated |
| corrected_estimate_minutes | integer | `estimate × estimation_factor` at generation time; capacity is checked against this |
| actual_minutes | integer not null default 0 | sum of the block's focus sessions |
| status | enum | `pending` / `active` / `done` / `partial` / `skipped` / `dropped` |
| skip_reason | enum nullable | `no_time` / `no_energy` / `blocked` / `changed_priority` / `avoided` / `unreported` |
| outcome_note | text nullable | free-form line at close-out |
| carried_from_block_id | uuid FK → plan_blocks, nullable | debt chain; `set null` on delete |
| carry_count | smallint not null default 0 | ≥3 = *rotting*: pinned first, escalated wording |
| started_at / completed_at | timestamptz nullable | |
| created_at / updated_at | timestamptz | |

Indexes: `(plan_id, position)`; `(user_id, status)`.

### focus_sessions

One start→stop run of the timer on a block; pausing ends a session, resuming opens the next one.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| block_id | uuid FK → plan_blocks | cascade |
| user_id | uuid FK → users | |
| started_at | timestamptz | |
| ended_at | timestamptz nullable | null = currently running (at most one per user) |
| duration_seconds | integer nullable | written at stop; the source of `plan_blocks.actual_minutes` |
| ended_reason | enum nullable | `completed` / `paused` / `abandoned` / `auto` (tick closed a session left running overnight) |

Index: `(user_id, ended_at)` — finding the running session.

### planner_nudges

Scheduled reminders; the tick job claims a row before sending, which makes delivery idempotent.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| plan_id | uuid FK → day_plans, nullable | |
| block_id | uuid FK → plan_blocks, nullable | |
| kind | enum | `morning` / `block_start` / `midway` / `evening` / `escalation` / `debt` |
| channel | enum | `telegram` / `in_app` |
| scheduled_for | timestamptz | |
| status | enum | `pending` / `sent` / `acknowledged` / `ignored` / `cancelled` |
| repeat_index | smallint not null default 0 | escalation counter, capped by `escalation_max_repeats` |
| sent_at / acknowledged_at | timestamptz nullable | |
| telegram_message_id | text nullable | for editing the message after an inline-button action |
| created_at | timestamptz | |

Index: `(status, scheduled_for)` — the tick's only hot query.

## Deduplication (v1 heuristic, ADR-004)

1. Normalize company: lowercase, trim, strip legal suffixes (`llc`, `inc`, `gmbh`, `ооо`, ...).
2. Candidate set: same `company_normalized`, `published_at` within ±14 days.
3. Fuzzy title match (trigram similarity / Levenshtein ratio ≥ threshold, tune on real data).
4. The earliest-ingested vacancy stays canonical; later ones get `canonical_vacancy_id` set.
5. Feed and matching operate on canonical vacancies only.
