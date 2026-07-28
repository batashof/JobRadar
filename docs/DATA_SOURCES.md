# Data Sources

> Global politeness rules apply to **every** source: fetch at most once per 4 hours, cache responses, exponential backoff on errors, honest User-Agent, no proxies. Proxies are a "success problem" — revisit only if the project outgrows these rules. An ingestion run returning zero items sets `sources.last_run_status = 'empty'` and triggers a Sentry alert (likely breakage or ban).

> **Quality gate (ADR-016).** Every board worker sanitizes descriptions through the shared `ingestion/description.ts`: HTML/entity decoding, mojibake repair, and removal of board boilerplate (anti-spam footers, cookie banners). An item whose cleaned description is shorter than 200 characters is **not ingested** — it is a stub or a scraped page, not a vacancy. Telegram is exempt (raw post text, own rules per ADR-009).

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
| Setup | Generate the session string locally with `pnpm --filter @jobradar/api telegram:session` (interactive, asks phone/code/2FA). Channels live in `sources.config.channels` (usernames without `@`, `messagesPerChannel` defaults to 50). The worker skips politely (no alert) while secrets or the channel list are missing |

### 2. WeWorkRemotely — RSS — **active (secondary)**

| | |
|---|---|
| Kind | RSS feeds per category — five of them, fetched in one run |
| Endpoints | `https://weworkremotely.com/categories/<c>.rss` for `remote-programming-jobs`, `remote-full-stack-programming-jobs`, `remote-back-end-programming-jobs`, `remote-front-end-programming-jobs`, `remote-devops-sysadmin-jobs` |
| Auth | None |
| Data quality | Medium: title/company in one string ("Company: Title"), needs parsing; no salary |
| Notes | Conditional GET (`If-Modified-Since`) on every feed; a run counts as `notModified` only when *all* feeds return 304. The per-speciality feeds are far larger than the general programming one and overlap heavily, so the worker dedupes by guid |

### 3. Himalayas — JSON feed — **active (secondary)**

| | |
|---|---|
| Kind | Public JSON API |
| Endpoint | `https://himalayas.app/jobs/api?limit=20&offset=N` |
| Auth | None. Terms ask for a credited link back — the vacancy `url` (their posting permalink) provides it |
| Data quality | Best of the free feeds: annual `minSalary`/`maxSalary` + `currency`, `seniority`, `employmentType`, `locationRestrictions`, `categories`/`parentCategories`, full description |
| Notes | No server-side category filter and `limit` is silently clamped to 20, so the worker pages (10 pages ≈ 200 newest postings per run) and keeps tech roles client-side: `parentCategories` allowlist when present, else a regex over `categories`. Only `salaryPeriod: annual` figures reach the salary filters. Their RSS feeds are Cloudflare-gated — use the API |

### 4. Remotive — JSON feed — **active in v1.0 (secondary)**

| | |
|---|---|
| Kind | Public JSON feed |
| Endpoint | `https://remotive.com/api/remote-jobs?category=software-dev` (payload under `jobs`) |
| Auth | None. Terms request a link back to the original posting — the vacancy `url` provides it |
| Data quality | Good: `category`, `tags`, `job_type`, free-form `salary` string, `candidate_required_location` |
| Notes | The `category` filter is unreliable (the feed still mixes in non-tech items), so the worker keeps only a tech-category allowlist client-side. Salaries are free text — only clear *annual* figures are parsed; hourly rates stay null. `contract`/`freelance` fold into the `freelance` employment enum |

### 5. Jobicy — JSON feed — **active in v1.0 (secondary)**

| | |
|---|---|
| Kind | Public JSON feed (API v2) — two industry feeds, fetched in one run |
| Endpoints | `https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50` and the same with `industry=data-science` (payload under `jobs`) |
| Auth | None. Terms request a credited link back and apply buttons pointing at the original posting |
| Data quality | Good: `jobIndustry`, `jobType`, `jobGeo`, `jobLevel`, full `jobDescription` HTML. No structured salary |
| Notes | `industry=dev` already scopes to software roles; `data-science` adds ML/data roles the dev feed misses. The feeds overlap, so the worker dedupes by job id. `jobType` maps to the employment enum (`Full-Time`→full_time, `Contract`/`Freelance`→freelance) |

### 6. Hacker News "Who is hiring?" — Algolia search API — **active (secondary)**

| | |
|---|---|
| Kind | Monthly `Ask HN: Who is hiring?` thread; top-level comments are the job posts |
| Endpoints | `https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring` to find the threads, then `…/search?tags=comment,story_<id>&hitsPerPage=100&page=N` for the posts |
| Auth | None |
| Data quality | Free-form prose with a conventional pipe header: `Company \| Role \| Location \| REMOTE \| Full-time \| $180k-$230k`. Salary is present on ~30% of posts |
| Notes | The Algolia API is used instead of the HN Firebase API because it returns comments **in bulk** (5 requests instead of ~450). Two threads are walked so the feed does not empty out on the 1st of the month. Every field is matched by shape, not position; a post whose header names no role is dropped rather than titled "REMOTE (US)". **Onsite-only posts are dropped** — this is a remote-work radar and the thread is full of single-city roles. The same bot account also posts "Who wants to be hired?" and "Freelancer?", so the thread title is matched. Measured: 436 comments → 269 job posts → ~150 remote/hybrid vacancies per thread |

### 7. Company career pages (ATS) — Greenhouse / Ashby / Lever — **active (secondary)**

| | |
|---|---|
| Kind | Public, unauthenticated job-board APIs of three applicant tracking systems, polled per company |
| Endpoints | `boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true` · `api.ashbyhq.com/posting-api/job-board/<token>?includeCompensation=true` · `api.lever.co/v0/postings/<token>?mode=json` |
| Auth | None |
| Data quality | **The best in the pipeline** — straight from the employer, so no aggregator boilerplate, no scraped pages, no stale reposts. Full descriptions (4–12 KB). Ashby adds a compensation range and employment type, Lever an employment type |
| Company list | Curated, in `sources.config.companies` as `{ ats, token, name }`. 36 boards as of 2026-07-28, each probed live and kept only when it yielded 6+ remote engineering roles. Adding one is a one-line config change — the token is the identifier in the company's careers-page URL |
| Notes | Every board mixes engineering with sales/HR and remote with onsite, so both filters are applied per adapter from whatever that ATS actually publishes. **Ashby's `isRemote` is not usable** — boards set it on hybrid roles too (OpenAI: 475 "remote" postings, 446 of them `workplaceType: Hybrid`); only `workplaceType` is honest, with the location string as a fallback when it is absent. Greenhouse publishes no remote flag at all, so its location string is the only signal, and its `content` is HTML **entity-encoded twice**. A board that 404s (renamed token, acquisition) is logged and skipped; only a run where *every* board fails is an error |

### 8. Working Nomads — JSON feed — **active in v1.0 (secondary, freelance-leaning)**

| | |
|---|---|
| Kind | Public JSON feed (a flat array) |
| Endpoint | `https://www.workingnomads.com/api/exposed_jobs/` |
| Auth | None |
| Data quality | Medium: `title`, `company_name`, `category_name`, comma-joined `tags`, `location`, `pub_date`. No salary or employment type. Only the "exposed" slice (~40 items) is public |
| Notes | Aggregates remote/contract roles including freelance marketplaces (e.g. Lemon.io). The worker keeps only the `Development` category to stay on-topic. `external_id` is the trailing numeric id in the job URL |

## Later sources (phase 4)

### Djinni

- No public API → HTML parsing, gently and later. Low priority; also covered by the manual browser-extension flow.

## Explicitly excluded

### Boards probed and rejected (2026-07-28)

Each was fetched live and inspected before being turned down; recorded so they are not re-probed:

| Board | Why not |
|---|---|
| The Muse (`themuse.com/api/public/jobs`) | `descending=true` does not sort, and the category filter is unreliable in the same way RemoteOK's was — "Café Associate" and "Retail Manager – Tire and Battery Center" come back under Software Engineering |
| Arbeitnow | Only 11 of 110 items per page are remote; a German general-purpose board, mostly onsite and non-tech |
| Landing.jobs | Real EU tech postings with salary, but a fixed 50-item response with no pagination, only 12 of them remote, and half dating back to early 2025 |
| Rise (`api.joinrise.io`) | No description field at all — nothing for matching, the fit score or contact extraction to work with |
| 4dayweek.io | Same: structured salary and locations, but no description; mixed verticals |
| DevITjobs UK | An 8.5 MB feed of mostly onsite UK roles with 2023 publication dates |
| Jobspresso | WordPress job feed capped at 10 items |
| NoDesk, startup.jobs, remote.co, RemoteRocketship, remotejobs.io, wfh.io | 403/404/dead — no usable public feed |
| Adzuna, Findwork.dev, Jooble | Free tiers exist but require registering for an API key; revisit only if the free boards stop being enough |
| Workable | `apply.workable.com/api/v1/widget/accounts/<token>` returns the company profile, not its jobs; no public per-company job endpoint found |

### RemoteOK — deactivated 2026-07-28 (ADR-016)

Was an active v1.0 secondary source. Their free `https://remoteok.com/api` has degraded into a scraped web index: a live sample of 100 items (and of `?tag=dev`) contained **zero IT vacancies** — municipal pages, marketing glossary entries, 404 pages, product blurbs — and every item carries an anti-spam footer *"Please mention the word \*\*X\*\* and tag … to show you read the job post completely"*, which for half of them was the entire description. The row stays in `sources` with `is_active = false` and the worker is kept: flipping the flag is all it takes if their feed recovers.

### hh.ru — dropped (ADR-009)

Was the intended primary v1.0 source but never went live: the API geo-403s anonymous calls from non-CIS IPs, and a dev.hh.ru application token requires a Russian phone number the developer doesn't have (a paid/infra workaround is barred by ADR-001). Not part of v1.0 or any later phase. The existing worker + `HH_API_TOKEN` plumbing is inactive legacy code. Telegram replaces it as the primary source.

### LinkedIn — no automated access, ever (ADR-003)

Aggressive anti-bot systems, no public API for vacancies, account-ban risk. Compensation: **browser extension** (phase 4) — a one-click "Save to JobRadar" button that sends the currently open vacancy page (any site, including LinkedIn and Djinni) to the API as a `manual`-source vacancy. The user does the browsing; JobRadar only stores what the user explicitly saves.

## Normalization contract

Every source worker maps raw items into the common shape (see [DATA_MODEL.md](DATA_MODEL.md) → `vacancies`): `external_id`, `url`, `title`, `company_raw`, `description`, and whatever of `work_format` / `employment_type` / salary / `location` / `published_at` the source provides. Missing fields stay null — matching rules must tolerate sparse data.

`description` always goes through `cleanDescription()` from `ingestion/description.ts`, and the worker's item predicate rejects anything failing `hasSubstantialDescription()` (ADR-016). Adding a source means reusing both — never a private `stripHtml`.
