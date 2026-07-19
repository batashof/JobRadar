# Data Model

> Status: **implemented** (ADR-008: Drizzle). Source of truth in code: `apps/api/src/db/schema.ts`; migrations in `apps/api/drizzle/`. Keep this file in sync with the schema.
> FTS note: `search_vector` uses the `simple` text-search config (sources mix Russian and English; no language-specific stemming in v1 — revisit when tuning relevance on real data).

## Entity overview

```
User 1──n SearchProfile
User 1──n Application n──1 Vacancy
Vacancy n──1 Source
Vacancy n──n Vacancy          (duplicate links)
SearchProfile n──n Vacancy    (matches, materialized)
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
| created_at / updated_at | timestamptz | |

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

## Deduplication (v1 heuristic, ADR-004)

1. Normalize company: lowercase, trim, strip legal suffixes (`llc`, `inc`, `gmbh`, `ооо`, ...).
2. Candidate set: same `company_normalized`, `published_at` within ±14 days.
3. Fuzzy title match (trigram similarity / Levenshtein ratio ≥ threshold, tune on real data).
4. The earliest-ingested vacancy stays canonical; later ones get `canonical_vacancy_id` set.
5. Feed and matching operate on canonical vacancies only.
