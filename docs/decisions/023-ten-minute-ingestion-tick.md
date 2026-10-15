# ADR-023: A 10-minute ingestion tick, fired by Supabase pg_cron, with per-source intervals

- Status: Accepted
- Date: 2026-10-15
- Amends ADR-006 (the external trigger moves from GitHub Actions to the database; the workflows stay as a fallback), the global 4-hour politeness rule in docs/DATA_SOURCES.md, and ADR-020 §3 (settle delay 10 → 5 minutes)

## Context

The user wants every vacancy pushed to Telegram while it is fresh: check the sources every 10 minutes and send what is new right away.

Two things stood in the way.

1. **GitHub Actions does not keep a free schedule.** The keep-alive workflow is set to `*/10 * * * *`, but on 2026-10-15 it ran at 00:22, 04:59, 09:45, 14:26 and 18:30 UTC, once every 4–5 hours. The 4-hourly ingestion cron ran 5–9 hours apart. GitHub delays and drops scheduled runs under load, and short schedules are hit hardest. So the Render instance (which sleeps after 15 minutes without an inbound request) was asleep most of the day, and the in-process digest tick (ADR-020) slept with it.
2. **Every source was capped at one fetch per 4 hours** (DATA_SOURCES.md). That is right for public aggregators, which refresh rarely and ask for gentle use. It is not needed for Telegram (our own MTProto session reading public channels, which is what any Telegram client does) or LinkedIn alerts (our own mailbox). Those two are also where a posting appears first.

A faster cycle multiplies whatever each cycle costs, and several free quotas are close:

- **Supabase egress (5 GB/month).** Dedup read every canonical vacancy (~17k rows) per run.
- **LLM free tiers (ADR-005).** The résumé pass spends up to 10 calls per matching run on the backlog.
- **Upstash commands (500k/month, RISKS #8).** Each BullMQ job costs Redis commands.

## Decision

1. **The trigger lives in the production database.** Supabase ships `pg_cron` (a job scheduler inside Postgres) and `pg_net` (asynchronous HTTP from SQL) on the free plan. A cron job `jobradar-ingestion-tick` runs `*/10 * * * *` and POSTs to `/ingestion/run`. The bearer token is stored in Supabase Vault and read when the job runs, so it never sits in `cron.job`. The tick is also the keep-alive: an inbound request every 10 minutes keeps Render awake, and one always-on free service fits Render's 750 instance-hours a month. Set up, inspected and removed with `DB (prod)` → `schedule:enable` / `schedule:status` / `schedule:disable` (`apps/api/src/db/prod-schedule.ts`). A second job prunes `cron.job_run_details` after 7 days. The GitHub workflows stay as a fallback.
2. **Each source has its own interval** (`apps/api/src/ingestion/schedule.ts`): `telegram` and `linkedin` 10 minutes, `ats` and `weworkremotely` 1 hour (employer APIs and conditional-GET RSS built for polling), every other source 4 hours as before. A source that failed or came back empty is retried after `min(interval, 1 h)`, never on every tick. Two minutes of slack absorb the gap between a run's start and the `last_run_at` written at its end.
3. **The hook enqueues only due sources**, then dedup and match. When nothing is due it enqueues nothing, so an idle tick costs one small query and no Upstash commands. `force` still enqueues every active source.
4. **Dedup reads only what can pair with something new**: canonical rows of companies that received a vacancy in the last 24 hours, ingested within twice the dedup window. Older pairs were compared by earlier runs.
5. **The LLM résumé pass keeps a 4-hour cadence** while rules-based matching runs every tick (in-memory gate in the processor; a restart only brings the next pass forward). The digest's own scoring is unchanged: it scores only what is new.
6. **Instant-mode settle delay is 5 minutes** (was 10). A tick's jobs (two fast sources, dedup, match) finish within a couple of minutes.

## Consequences

- A Telegram posting reaches the user about 10–20 minutes after it is published (tick + settle + the 5-minute digest tick), in instant mode and outside quiet hours. LinkedIn alerts are as fresh as LinkedIn sends them (daily).
- The scheduler is now a Supabase-specific feature. It is scheduling only, not core logic: on another Postgres host the same call can come from any free HTTP cron (cron-job.org), and the GitHub workflows still fire whenever GitHub runs them.
- Telegram is read 144 times a day. Each run re-reads the latest 50 posts per channel and upserts them (unchanged rows do not move `content_changed_at`, so matching ignores them). FLOOD_WAIT is respected as before. If writes become a problem, fetching only posts newer than the last seen id is the next step.
- Upstash: about four jobs per tick (two sources, dedup, match), roughly 6k commands a day. Watch the Upstash dashboard; if it creeps up, the tick can run the fast sources in-process without BullMQ.
- The digest may call the LLM more often with smaller batches. Failover across providers and the rules-based fallback (ADR-005) cover a provider that runs out.
