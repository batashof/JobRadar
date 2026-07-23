# ADR-015: Day planner with accountability loop (LLM-composed timebox queue, Telegram nudges, rolling debt)

- Status: Proposed
- Date: 2026-07-23

## Context

The author is running three parallel tracks — searching and applying for jobs, preparing for interviews, and taking courses (Anthropic certification) — and the practical bottleneck is no longer *finding* work to do but *doing it*: switching between tracks, mis-estimating how long things take, and losing whole days without a clear reason. The data needed to plan a day already lives in JobRadar: applications waiting on a follow-up (`applications.last_activity_at` + `remind_after_days`), `todo` topics in the interview prep plan (ADR-013), and matched vacancies in the feed. What is missing is a surface that turns that state into a small, committed, trackable plan for today.

A plain calendar has already failed for this user: it is trivially ignorable, and one shifted appointment invalidates every later slot. So the requirement is explicitly not "a calendar" but **a plan that is hard to ignore** and **estimates that get better over time**.

Constraints:

- **$0 budget (ADR-001)** — no paid scheduler, no push service, no calendar SaaS.
- **Backend is a separate service (ADR-002)** — scheduling and reminder delivery live in the API, not in Next.js.
- **Render free tier sleeps after ~15 min** (ADR-007), but the existing `keep-alive` workflow already pings `/health` every 10 minutes, so the API process is effectively always warm.
- **GitHub Actions minutes are finite** — this is a *private* repo, so a minute-granularity workflow cron (≈4300 min/month) would blow the free allowance. ADR-006's external-cron pattern does not scale to reminder-level granularity.
- **LLM token discipline (ADR-005/011)** — planning must cost at most a couple of calls per day, cached.
- **Language (ADR-014)** — plan text and bot messages follow `users.language`.

## Decision

Add a **day planner** module: `planner/` on the API, `/app/day` on the web, one new Telegram **bot** channel. It is a personal accountability loop, not a calendar.

### 1. Structure: an ordered queue of timeboxes, not a time grid

A day plan is an **ordered list of blocks** (25–50 min each) with an estimate in minutes and no wall-clock start time. You start the next block when you are ready; the queue survives a two-hour derailment intact. Wall-clock times exist only as the two ritual moments below.

### 2. Composition: LLM planner over real DB state

Once per day (at the morning-ritual time, or on demand) the planner assembles **candidates** with plain SQL — no LLM:

| Candidate kind | Source |
|---|---|
| `application_followup` | `applications` in waiting stages past their reminder threshold |
| `interview_topic` | `todo` / `in_progress` topics of the active `interview_plans` (ADR-013) |
| `vacancy_apply` | fresh feed vacancies above a resume-fit / profile-match bar (ADR-012) |
| `debt` | blocks carried over from previous days (see §4) |
| `manual` | anything the user added to the backlog |

The LLM (ADR-005 gateway, one call per generated plan, `users.language`) receives the candidate list plus the day's capacity and the user's estimation factor (§5), and returns an ordered, capacity-fitting selection with per-block titles and estimates. It **selects and sequences**; it never invents work that has no candidate behind it. Generation is idempotent per `(user, date)` and re-runnable on explicit "regenerate". If the LLM gateway is unavailable, the planner degrades to a deterministic ordering (debt → overdue follow-ups → prep topics → applications), so the feature never hard-depends on an LLM key.

### 3. The ritual: accept in the morning, close in the evening

- **Morning.** The plan is created as `draft`. It must be **explicitly accepted** (one action, in the app or from the bot). Until it is, the dashboard leads with the acceptance card instead of the usual content and the day counts as *unplanned* in the stats. Editing before accepting is expected — reorder, drop, add, change estimates.
- **Evening.** A **close-out review** walks the day's blocks: each is resolved as `done` / `partial` / `skipped`, skips take a one-line reason from a short list (`no time`, `no energy`, `blocked`, `changed priority`, `avoided it`). Closing the day computes the day's stats, updates the estimation factor, and rolls the unfinished blocks into debt. A day that is never closed is auto-closed by the tick job at end-of-day with everything unresolved marked `skipped (unreported)` — an unreported day is the worst-looking outcome in the stats, on purpose.

### 4. Rolling debt instead of streaks

Unfinished blocks are **never silently dropped**. At close they are carried into the next day's plan with `carry_count + 1` and are placed first in the candidate list. `carry_count ≥ 3` marks a block as *rotting*: it is pinned to the top of the plan, shown in a distinct style, and the bot's wording escalates. The dashboard shows a single debt figure (count + estimated minutes). The user can only clear debt by doing the block or explicitly **dropping** it with a reason — dropping is a deliberate, recorded act, not a silent disappearance.

### 5. Timer and estimation calibration

Every block has an estimate; starting a block opens a **focus session** (start / pause / resume / stop), and the accumulated session time is the block's `actual_minutes`. This exists mainly to fix estimation:

- **Estimation factor** = median of `actual / estimate` over the last N (default 20) completed blocks, computed globally and per category. It is shown plainly ("you take ×1.8 of what you plan") and is fed to the planner so generated estimates are pre-corrected.
- Day capacity is enforced against corrected estimates, which is what stops the plan from being a fantasy list.

Timing is honest but not coercive: no mid-block "are you still there?" interrogation. The tick job does send one **midway ping** for a block that has been running well past its corrected estimate.

### 6. Delivery: a Telegram bot (the anti-ignore channel)

The plan reaches the phone. A new **Telegram Bot API** channel (separate from the MTProto ingestion client of ADR-009 — different credentials, different direction) delivers:

| Nudge | When |
|---|---|
| `morning` | at the ritual time — today's draft plan, "Accept" button |
| `block_start` | when the queue's next block becomes current and nothing is running |
| `midway` | a running block is well past its corrected estimate |
| `evening` | close-out review reminder |
| `escalation` | a nudge left unacknowledged for the escalation interval, or rotting debt |
| `debt` | morning summary when debt is non-empty |

Messages carry inline buttons — *Start* / *Done* / *+15 min* / *Skip* — so a block can be resolved without opening the app. Delivery is outbound `sendMessage`; replies arrive on `POST /planner/telegram/webhook`, guarded by Telegram's secret-token header. Both are free and need only `TELEGRAM_BOT_TOKEN`; with no token the module degrades to in-app-only, exactly like the other optional integrations.

**Escalation** is bounded: a nudge repeats at most twice, at a configurable interval, then stops and is recorded as ignored. The point is a visible record of ignoring, not an unmutable alarm.

### 7. Scheduling: an in-process tick, not a workflow cron

A **BullMQ repeatable job `planner:tick` runs every minute inside the API**, picks due nudges, sends them, and performs day rollover per user timezone. This deliberately does *not* follow ADR-006: the external-cron rationale was free-tier sleeping, and the existing 10-minute keep-alive already keeps the instance warm, while a minute-granularity GitHub Actions cron would exceed the private-repo minute allowance. The tick is idempotent (`planner_nudges` rows are claimed before sending), so a restart or a brief container sleep only delays a nudge, never duplicates it.

### 8. Scope guards

- Single-user assumptions stay (one plan per user per day, one active prep plan).
- **No code execution, no external calendar sync, no paid push.** Google Calendar sync stays a separate, later roadmap item.
- The planner **reads** JobRadar state; it never applies to a vacancy or sends an outreach email on its own — those keep their explicit per-action confirmation (ADR-011).

## Consequences

- **Easier.** The three tracks (apply / prep / learn) get one committed queue per day, built from data that already exists; estimates become empirical rather than aspirational; skipping becomes visible and costly rather than invisible.
- **Harder / accepted trade-offs.**
  - The API gains a stateful, time-driven component, so correctness now depends on the process being alive. Mitigated by the existing keep-alive and by idempotent tick claims; a sleeping container delays nudges by up to 10 minutes.
  - Per-user **timezone** becomes real state (`planner_settings.timezone`) — the first place in the project where wall-clock correctness matters.
  - A second Telegram credential set (bot token) alongside the MTProto session; distinct names (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_WEBHOOK_SECRET`) to avoid confusion.
  - The bot channel partly delivers the roadmap's "Telegram bot as second digest channel" item; the digest itself stays out of scope here.
  - One LLM call per generated plan (≈1–2/day) — negligible under ADR-005, and the deterministic fallback means a key outage does not block the feature.
- **Deliberately not done.** No hard route-level gate blocking the vacancy feed until the current block is resolved, and no streak counter: the chosen pressure is the ritual + debt + bot, which records avoidance instead of locking the product. Both remain cheap to add later if debt alone proves ignorable.
