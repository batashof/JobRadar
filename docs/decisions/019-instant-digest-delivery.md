# ADR-019: Instant digest delivery — push new matches after each ingestion, not only on a schedule

- Status: Accepted
- Date: 2026-09-29
- Extends ADR-015 §7 (in-process scheduler, per-user timezone) and the Telegram digest built on it

## Context

The digest (v1.17–v1.21) goes out at 1–4 fixed local times a day and ranks a 14-day pool of unsent vacancies. A posting that lands at 10:00 reaches the user at the next slot — often the next morning — although for a job search being early is a real advantage: applications are read in the order they arrive.

"Send each vacancy the moment it appears" is bounded by how vacancies arrive. Every source is fetched at most once per 4 hours (DATA_SOURCES.md politeness rule, ADR-006 cron), so the earliest honest delivery is *right after an ingestion run*. True real-time exists only for the Telegram channels (a persistent MTProto update subscription) and would change the ingestion model ADR-009 and the 4-hour rule describe; it is out of scope here.

Two further constraints shape the design:

- **Database egress** (ADR-001, and the September 2026 Neon suspension fixed in v1.21.2): an extra delivery path must read the *new* vacancies, never re-scan the board.
- **LLM free tiers** (ADR-005): one call per push, over a short pre-filtered batch — not one call per vacancy.

## Decision

1. **A delivery mode per user**: `digest_settings.mode` = `scheduled` (unchanged behaviour, the default) or `instant`. In `instant` mode the send times are ignored.
2. **Driven by the existing 5-minute digest tick, not by the ingestion pipeline.** Each tick, for an instant-mode user, one aggregate query asks whether canonical vacancies were ingested after the user's watermark `digest_settings.instant_through`. If so, the same funnel as the scheduled digest runs over **only that window** (level gate → résumé-relevance order in SQL → one batch LLM call → floor → cap), the cards are sent, and the watermark moves to the window's upper bound. No coupling between the ingestion and digest modules; a restart or a missed tick just widens the next window.
3. **Settle delay of 10 minutes**: the window ends at vacancies ingested at least 10 minutes ago, so dedup and matching (queued after the source jobs) have run and a posting seen in three channels is pushed once.
4. **Quiet hours** in the user's timezone (`quiet_start`–`quiet_end`, default 22:00–08:00, may wrap midnight; equal = none). During them the tick does nothing and the watermark stays put, so whatever arrived overnight goes out as one batch when they end.
5. **A separate, stricter floor** `instant_min_score` (default 75). A scheduled digest compares a day's vacancies against each other; an instant push judges a handful on their own, and every push interrupts — so the bar is higher. `max_items` still caps one push; an empty result sends **nothing** (no "nothing worth your attention" message several times a day).
6. **First window**: switching to `instant` resets the watermark; a null watermark looks back 24 hours. The 14-day candidate window still bounds any window after a long sleep.
7. The manual "send now" button keeps producing a full scheduled-style digest in either mode.

## Consequences

- New vacancies reach Telegram 10 minutes to ~4 hours after they are published, instead of up to a day.
- Cost stays flat: one tiny aggregate query per instant user per tick; the funnel and its single LLM call run only when there is something new (≤ 6 times a day, the ingestion cadence) plus once after quiet hours.
- Only the 30 most résumé-relevant new vacancies of a window are scored (`BATCH_LIMIT`); the rest of that window is not revisited in instant mode. With ~50 new postings per 4-hour run this cuts the tail, not the head.
- Without an LLM key or on provider failure, the rules-based fallback score is used exactly as in the scheduled digest; the stricter floor limits noise.
- Real-time delivery for Telegram channels remains a possible later step and would need its own ADR (it changes ADR-009's ingestion model).
