# ADR-031: The ingestion queue runs in process; Redis and BullMQ are removed

- Status: Accepted
- Date: 2026-10-22
- Amends: ADR-006 (BullMQ for in-process orchestration), ADR-007 (BullMQ workers), ADR-001 (Upstash in the free-tier list), ADR-030 (Redis in the e2e harness and the prod smoke check)

## Context

On 2026-10-22 Upstash mailed the developer: the Redis database had used 90% of its 500,000 commands a month, with nine days of the month left. Once the quota is used up, Upstash refuses commands, BullMQ cannot take jobs, and ingestion stops. Then no new vacancy reaches anyone.

Redis carried one thing: the BullMQ ingestion queue. Since ADR-023 the hook fires every 10 minutes, and Telegram and LinkedIn alerts are due on every tick. That adds at least four jobs per tick (two sources, dedup, match), about 600 jobs a day, plus the hourly and 4-hour sources. Each job is a dozen or more Redis commands: add, move to active, lock renewals while it runs, finish, the events stream. The worker also polls while idle. Together that comes to roughly 15,000 commands a day, about 450,000 a month. Tuning the poll intervals in v1.10.3 had already cut the idle part; the jobs themselves are now the cost. The planner tick, the digest runner and the reminder sweep left Redis for in-process timers earlier for the same reason (ADR-015 §7).

The API is one Render instance (free tier). Nothing else reads the queue, so a distributed queue buys no safety.

## Decision

1. **`IngestionQueue`** (`apps/api/src/ingestion/ingestion-queue.ts`) replaces BullMQ. It is a FIFO array with one worker loop in the API process. `POST /ingestion/run` adds the due sources, then dedup, then match, and answers 202 before any job starts. Jobs run one at a time, in order. A job whose name is already waiting is not added again, so overlapping ticks do not pile up. One failed job does not stop the ones behind it.
2. **No retries in the queue.** BullMQ retried a failed job three times with backoff. Now a failed source is marked `error` in `sources.last_run_status`, and `schedule.ts` retries it after an hour, as it already did between ticks. Jobs lost to a restart are re-enqueued by the next tick, because `sources.last_run_at` is in Postgres.
3. **Redis is gone from the code**: `@nestjs/bullmq`, `bullmq` and `ioredis` are removed. `GET /health` no longer reports Redis, and neither does the prod smoke check. CI's e2e job and `docker-compose.yml` no longer start a Redis container. `REDIS_URL` is unused; the Upstash database can be deleted or left idle.

## Consequences

- Upstash commands drop to zero, and the free-tier risk in RISKS.md #8 is closed.
- No dashboard of failed jobs. Failures are visible in `sources.last_run_status`, Sentry, the Render log, and the prod smoke check, which alerts when no vacancy arrived in 6 hours.
- A long ingestion run shares the API process with the webhook, as the digest runner already does; jobs are I/O bound, so the event loop stays free.
- If the API ever runs on more than one instance, two instances would each run their own queue. The per-source due check and the upserts keep that safe but wasteful; a shared queue would then be worth its cost again.
