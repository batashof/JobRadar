# Data Sources

> Global politeness rules apply to **every** source: fetch at most once per 4 hours, cache responses, exponential backoff on errors, honest User-Agent, no proxies. Proxies are a "success problem" — revisit only if the project outgrows these rules. An ingestion run returning zero items sets `sources.last_run_status = 'empty'` and triggers a Sentry alert (likely breakage or ban).

## v1.0 sources

### 1. hh.ru — official API — **deferred (source inactive)**

> Status 2026-07-20: hh returns geo-403 for anonymous API calls from non-CIS IPs (both the dev machine and Render). Lifting it needs an application token from dev.hh.ru, whose registration requires a Russian phone number the developer doesn't have. The worker is fully implemented (incl. optional `HH_API_TOKEN`); the source stays `is_active=false` until a token is obtained. WeWorkRemotely serves as the second v1.0 source instead.

| | |
|---|---|
| Kind | Official public REST API (free) |
| Docs | https://api.hh.ru / https://github.com/hhru/api |
| Auth | Anonymous access is enough for vacancy search; app token optional |
| Endpoint | `GET /vacancies?text=...&search_field=...&schedule=remote...` |
| Pagination | `page` / `per_page` (max 100), capped at 2000 items per query |
| Rate limits | Undocumented but tolerant; stay well under by design (one run / 4h) |
| Data quality | Excellent: structured salary, employer, schedule, employment type |
| Notes | Query per active search profile keywords; store `id` as `external_id`; respect `Retry-After` on 429 |

### 2. RemoteOK — JSON feed — **active in v1.0**

| | |
|---|---|
| Kind | Public JSON feed |
| Endpoint | `https://remoteok.com/api` |
| Auth | None. Their API terms require linking back to the original posting — comply |
| Data quality | Good: tags, company, position, salary sometimes present |
| Notes | Single feed (~latest postings); filter client-side against profiles |

### 3. WeWorkRemotely — RSS — **active in v1.0** (replaces hh while it is deferred)

| | |
|---|---|
| Kind | RSS feeds per category |
| Endpoint | `https://weworkremotely.com/categories/remote-programming-jobs.rss` (and others) |
| Auth | None |
| Data quality | Medium: title/company in one string ("Company: Title"), needs parsing; no salary |
| Notes | Use conditional GET (`If-Modified-Since` / `ETag`) |

## Later sources (phase 4)

### HN Who's Hiring

- Monthly thread on Hacker News; fetch via official Firebase API (`https://hacker-news.firebaseio.com/v0/`).
- Find the current month's thread (Algolia HN Search API), pull top-level comments, parse semi-structured text (location, remote, stack).
- Hardest parsing of the friendly sources; a good candidate for LLM-assisted extraction (ADR-005).

### Telegram job channels

- Official Telegram Bot API / MTProto (e.g. GramJS) to read public channels.
- Channel list is user-configurable; parse messages with per-channel regex templates, later LLM.

### Djinni

- No public API → HTML parsing, gently and later. Low priority; also covered by the manual browser-extension flow.

## Explicitly excluded

### LinkedIn — no automated access, ever (ADR-003)

Aggressive anti-bot systems, no public API for vacancies, account-ban risk. Compensation: **browser extension** (phase 4) — a one-click "Save to JobRadar" button that sends the currently open vacancy page (any site, including LinkedIn and Djinni) to the API as a `manual`-source vacancy. The user does the browsing; JobRadar only stores what the user explicitly saves.

## Normalization contract

Every source worker maps raw items into the common shape (see [DATA_MODEL.md](DATA_MODEL.md) → `vacancies`): `external_id`, `url`, `title`, `company_raw`, `description`, and whatever of `work_format` / `employment_type` / salary / `location` / `published_at` the source provides. Missing fields stay null — matching rules must tolerate sparse data.
