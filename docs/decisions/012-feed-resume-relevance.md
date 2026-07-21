# ADR-012: Feed-centric, resume-driven relevance (remove the Matches page, soft seniority filter)

- Status: Accepted
- Date: 2026-07-21
- Supersedes the UI half of the phase-3 rules-based matching (ADR-011 §3 kept, re-surfaced)

## Context

Phase 3 introduced a separate **Matches** page: vacancies scored against the user's manually-defined **search profiles** (keyword + stack lists), materialized in `profile_matches`. In practice the author found it confusing and usually empty — a match requires a keyword to appear *literally* (substring, word-boundary) in the vacancy text, so a slightly-off keyword list yields zero rows and no feedback about why. The relevance signal the author actually cares about is the **resume**, not a hand-tuned keyword list.

ADR-011 already added LLM resume ↔ vacancy scoring (`resume_matches`), but it was buried: shown only on the Matches page, only for vacancies that first passed rules-based profile matching, and only after a budget-capped batch run. The resume never drove browsing.

Constraints unchanged: **$0 budget (ADR-001)** — free-tier LLM quotas are token-based, so nothing may score the whole vacancy table unprompted; **single user** in v1.x.

## Decision

Make the **Feed the single browse surface** and drive relevance from the resume.

1. **Remove the Matches page and its nav entry.** The profile-matching backend (`search_profiles`, `profile_matches`, the `match` job) and the Profiles page are **kept as-is, running in the background** — deleting them is a larger refactor with no user benefit here, and profiles remain a valid future basis for saved searches. They are simply no longer surfaced as a separate results view.

2. **On-demand resume-fit on the vacancy page (feature A).** A button on the detail page scores the active resume against that one vacancy through the ADR-005 LLM gateway, cached permanently in `resume_matches` (one call per resume × vacancy — a repeat is free). The result renders as a colour-banded circular gauge (red <40% < amber <70% < green) plus a short RU rationale. This is the honest "click a vacancy → see how well I fit and why" flow. The cached score also rides along as a `CV NN%` badge on feed cards.

3. **Soft resume-driven seniority filter (feature B).** A coarse level (`intern | junior | middle | senior | lead`) is detected at ingestion from the vacancy title + description by keyword rules (no LLM) and stored in `vacancies.seniority`. The feed offers a toggle — shown only when the user has an active resume — that hides vacancies **two or more grades below** the resume's detected level. Deliberately lenient:
   - the resume level is detected from its extracted text (highest keyword wins);
   - a gap of 2 keeps the adjacent grade (a senior still sees middle roles), dropping only the obvious mismatches (intern/junior);
   - vacancies with **no** detected level always pass, and detection biases toward the *highest* matched level — so the filter under-filters rather than over-empties the feed.

   No LLM is involved: the whole feed is filtered in SQL, not just a precomputed subset.

## Consequences

- Easier: one surface to learn; relevance comes from the resume the user already uploaded, with a visible, explained percentage; the seniority toggle trims the obvious noise for free.
- Harder / accepted: keyword-based seniority detection is coarse and misses roles that state no level (they pass) — acceptable for a soft filter; keeping the now-invisible profile-matching backend is mild dead weight, tolerated to avoid ripping out tested phase-2/3 code (a future ADR may retire or repurpose it as saved feed filters).
- Migration `0004` adds `vacancies.seniority`; a `backfill:seniority` script classifies pre-existing rows (idempotent, `--prod` over Neon HTTPS), mirroring the ADR-011 contact backfill.
