# Data Sources

> Global politeness rules apply to **every** source: fetch at most once per 4 hours, cache responses, exponential backoff on errors, honest User-Agent, no proxies. Proxies are a "success problem" — revisit only if the project outgrows these rules. An ingestion run returning zero items sets `sources.last_run_status = 'empty'` and triggers a Sentry alert (likely breakage or ban).

## v1.0 sources

### 1. Telegram job channels — MTProto — **primary source (ADR-009)**

> Elevated from phase 4 to the primary v1.0 source: Telegram is where CIS/IT vacancies are *first* posted. Replaces hh.ru, which is dropped (ADR-009).

| | |
|---|---|
| Kind | Public channel messages read over MTProto (GramJS) |
| Auth | `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` from my.telegram.org (free) + a persisted user **session string** (secret). The Bot API cannot read arbitrary public channels, so MTProto is required |
| Channels | User-configurable list; each channel gets its own parsing template |
| Parsing | Per-channel regex first (title / stack / format / contact); LLM-assisted extraction later (ADR-005). Missing fields stay null |
| `external_id` | `<channel>:<message_id>` (stable, dedup-friendly) |
| `url` | `https://t.me/<channel>/<message_id>` deep link — this is the "open vacancy" target; **no in-app apply**, the user responds in Telegram |
| Rate limits | Global 4-hour politeness rule applies; respect MTProto FLOOD_WAIT; honest client, no proxies |
| Notes | Store the session string as a secret; a run yielding zero items across all channels sets `last_run_status='empty'` and alerts (likely a broken template or ban) |

### 2. RemoteOK — JSON feed — **active in v1.0 (secondary)**

| | |
|---|---|
| Kind | Public JSON feed |
| Endpoint | `https://remoteok.com/api` |
| Auth | None. Their API terms require linking back to the original posting — comply |
| Data quality | Good: tags, company, position, salary sometimes present |
| Notes | Single feed (~latest postings); filter client-side against profiles |

### 3. WeWorkRemotely — RSS — **active in v1.0 (secondary)**

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

### Djinni

- No public API → HTML parsing, gently and later. Low priority; also covered by the manual browser-extension flow.

## Explicitly excluded

### hh.ru — dropped (ADR-009)

Was the intended primary v1.0 source but never went live: the API geo-403s anonymous calls from non-CIS IPs, and a dev.hh.ru application token requires a Russian phone number the developer doesn't have (a paid/infra workaround is barred by ADR-001). Not part of v1.0 or any later phase. The existing worker + `HH_API_TOKEN` plumbing is inactive legacy code. Telegram replaces it as the primary source.

### LinkedIn — no automated access, ever (ADR-003)

Aggressive anti-bot systems, no public API for vacancies, account-ban risk. Compensation: **browser extension** (phase 4) — a one-click "Save to JobRadar" button that sends the currently open vacancy page (any site, including LinkedIn and Djinni) to the API as a `manual`-source vacancy. The user does the browsing; JobRadar only stores what the user explicitly saves.

## Normalization contract

Every source worker maps raw items into the common shape (see [DATA_MODEL.md](DATA_MODEL.md) → `vacancies`): `external_id`, `url`, `title`, `company_raw`, `description`, and whatever of `work_format` / `employment_type` / salary / `location` / `published_at` the source provides. Missing fields stay null — matching rules must tolerate sparse data.
