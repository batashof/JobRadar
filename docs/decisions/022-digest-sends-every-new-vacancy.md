# ADR-022: The digest sends every new vacancy, not a top ten

- Status: Accepted
- Date: 2026-10-14
- Amends ADR-020 §2, §5 and its consequence on `BATCH_LIMIT`; amends the digest's "ten is the hard ceiling" rule (v1.17.0)

## Context

Every push held exactly ten vacancies, however many had arrived. Two limits stacked up:

- `digest_settings.max_items` defaulted to 10, and 10 was also the hard ceiling the API accepted.
- Only the 30 best-ranked candidates (`BATCH_LIMIT`) were ever scored by the LLM. Everything past them was dropped without being judged; in instant mode the watermark then moved past them, so they never came back.

With LinkedIn alert emails (ADR-021) a single ingestion run brings dozens of relevant postings, so "the best ten" threw away matches the user wanted. The user asked for every new vacancy since the previous notification, however many that is.

The scheduled digest also had no notion of "since the previous notification": each slot re-ranked the whole 14-day pool of unsent vacancies, so a posting that missed the cut once competed again at every slot, and the same rejected postings were re-scored again and again.

## Decision

1. **No cap by default.** `max_items` becomes nullable; null (the new default) means every new vacancy that clears the floor (`min_score`, or `instant_min_score` in instant mode) goes out. A user can still set a cap, up to `DIGEST_MAX_ITEMS_LIMIT` = 200. Migration `0018` clears all stored values, since the old 10 was a forced ceiling, not a choice. The floor stays: "every new vacancy" means every new *match*, not every posting on the board.
2. **Every candidate is scored.** The window is scored in batches of `BATCH_LIMIT` (30), one LLM call per batch, run one after another so free-tier per-minute token limits are not tripped by a burst. A failed batch falls back to the rules score for that batch only.
3. **Both modes report only what arrived since the previous send.** The instant-mode watermark is renamed `instant_through` → `judged_through` and now serves the scheduled digest too: a slot covers the vacancies ingested (and settled for 10 minutes) after the previous slot, then moves the watermark. A slot with nothing new still says "nothing worth your attention", because the user expects a message at that hour. The manual "send now" keeps weighing the whole unsent fortnight and does not move the watermark.
4. **A send judges at most 200 vacancies** (`CANDIDATE_POOL`, the most résumé-relevant first), so a window left open by a long outage costs at most 7 LLM calls.
5. **Telegram flood limits are waited out.** A chat accepts roughly one message per second; a long digest exceeds that. On a 429 the bot waits Telegram's `retry_after` (at most 30 s) and retries once, because the digest records a vacancy as delivered whether or not its card arrived.

## Consequences

- The user gets every new match, in as many messages as it takes (one card per vacancy, as before). A busy run can mean dozens of cards in a row.
- LLM usage grows with intake: one call per 30 new candidates instead of one per push. Since each send now covers only new arrivals, a quiet day still costs one call per push, and re-scoring the same rejected postings at every scheduled slot stops.
- A vacancy that missed the floor is not reconsidered in a later scheduled slot. It is still in the feed.
- The column rename breaks the 1.23.x API, which reads `instant_through`. Migration `0018` must be applied together with the deploy; in between, the digest of each user fails and logs an error, and nothing else is affected.
