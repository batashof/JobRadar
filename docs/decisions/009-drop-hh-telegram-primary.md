# ADR-009: Drop hh.ru; Telegram job channels as the primary source

- Status: Accepted
- Date: 2026-07-20

## Context

hh.ru was the intended primary v1.0 source. In practice it never went live:
its API geo-403s anonymous calls from non-CIS IPs (both the dev machine and
Render), and lifting that needs an application token from dev.hh.ru, whose
registration requires a Russian phone number the developer does not have. The
worker exists but the source has been `is_active=false` since 0.2.0.

Keeping hh as a "deferred" source is dead weight: it will not become reachable
without infrastructure (a CIS-resident token/IP) the zero-budget constraint
(ADR-001) forbids paying for. Meanwhile the sources that actually matter for
this developer — where vacancies are *first* posted — are Telegram job
channels, which were parked in phase 4.

## Decision

1. **Drop hh.ru as a source.** It is no longer part of v1.0 or any later phase.
   The existing worker + `HH_API_TOKEN` plumbing is treated as inactive legacy
   code (may be removed later); no further effort goes into re-enabling hh.
2. **Promote Telegram job channels to the primary source**, elevated from
   phase 4 into the near-term roadmap. Read public channels via MTProto
   (GramJS): `api_id`/`api_hash` from my.telegram.org (free) + a stored user
   session string. The Bot API is insufficient for arbitrary public channels.
3. **The vacancy feed exposes its source.** Every vacancy shows which platform
   it came from, and the feed gains a platform filter (checkboxes) so the user
   can narrow to specific sources. The "open vacancy" action is a link to the
   original (for Telegram, a `t.me/<channel>/<msgId>` deep link) — no in-app
   apply (see the "search + link out" model in PRODUCT.md).

The aggregated remote-work boards (RemoteOK JSON, WeWorkRemotely RSS) stay
active as secondary sources.

## Consequences

- **Easier:** no dependency on a Russian phone number / CIS IP; the whole
  ingestion story stays inside free tiers. Telegram is where CIS/IT vacancies
  appear first, so coverage improves for the actual user.
- **Harder:** Telegram posts are free-form text. Extraction needs per-channel
  regex templates first, LLM-assisted parsing later (ADR-005). MTProto needs a
  persisted user session secret and careful rate limiting (global 4-hour
  politeness rule still applies; channel list is user-configurable).
- **Trade-off accepted:** losing hh's structured salary/employer/schedule data.
  Missing fields stay null; matching must tolerate sparse data (already the
  normalization contract). No in-app apply for Telegram — the user opens the
  original post to respond.

This supersedes the hh-centric parts of the earlier v1.0 source plan
(PRODUCT.md v1.0 scope, DATA_SOURCES.md) and the phase-4 placement of Telegram
(ROADMAP.md).
