/**
 * How often each source may be fetched (ADR-023, amends the global 4-hour rule
 * of docs/DATA_SOURCES.md).
 *
 * The ingestion hook is called every 10 minutes, but only sources whose
 * interval has elapsed are fetched:
 *
 * - `telegram` and `linkedin` read our own MTProto session and our own mailbox,
 *   and they are where a posting appears first — 10 minutes;
 * - `ats` and `weworkremotely` are employer / RSS endpoints built for polling
 *   (WWR answers conditional GETs with 304) — hourly;
 * - every other public aggregator keeps the original 4 hours: they refresh
 *   rarely, and their terms ask for gentle use.
 */
const MINUTE = 60 * 1000;

export const DEFAULT_SOURCE_INTERVAL_MS = 240 * MINUTE;

export const SOURCE_INTERVAL_MS: Readonly<Record<string, number>> = {
  telegram: 10 * MINUTE,
  linkedin: 10 * MINUTE,
  ats: 60 * MINUTE,
  weworkremotely: 60 * MINUTE,
};

/**
 * A source that failed or came back empty is retried sooner, but never more
 * often than its own interval: a broken 10-minute source must not be retried
 * every tick with three attempts each.
 */
const RETRY_AFTER_FAILURE_MS = 60 * MINUTE;

/**
 * `last_run_at` is written when a run *ends*, while ticks are spaced from their
 * *start*. Without slack a 10-minute source finishing a minute into its run
 * would be "9 minutes old" at the next tick and skipped every other time.
 */
const TICK_SLACK_MS = 2 * MINUTE;

export function sourceIntervalMs(slug: string): number {
  return SOURCE_INTERVAL_MS[slug] ?? DEFAULT_SOURCE_INTERVAL_MS;
}

export interface SourceRunState {
  slug: string;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
}

/** Whether a source should be fetched now (a manual `force` always is). */
export function isSourceDue(source: SourceRunState, now: Date, force = false): boolean {
  if (force || source.lastRunAt === null) return true;
  const interval = sourceIntervalMs(source.slug);
  const wait =
    source.lastRunStatus === 'ok' ? interval : Math.min(interval, RETRY_AFTER_FAILURE_MS);
  return now.getTime() - source.lastRunAt.getTime() >= wait - TICK_SLACK_MS;
}
