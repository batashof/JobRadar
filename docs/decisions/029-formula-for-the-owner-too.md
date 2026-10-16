# ADR-029: The owner's vacancies are scored by the formula too; the LLM reads resumes only (amends ADR-011, ADR-024 §3, ADR-025 §8)

- Status: Accepted
- Date: 2026-10-16
- Amends ADR-011 (background resume ↔ vacancy pass), ADR-024 §3 and ADR-025 §8 (owner judged by the LLM)

## Context

Since 2.0.0 every bot user's vacancies are scored by the formula (ADR-025), except the owner's, which were still judged by the LLM in batches. A background pass (ADR-011) also LLM-scored up to ten vacancies against the owner's resume every four hours.

On the night of 2026-10-16 both competed for Groq's free tier, 8000 tokens per minute with the output budget counted. Every scoring call failed with HTTP 413/429, Gemini answered 429/503, the rules fallback scored below the owner's floor, and the owner received nothing for about five hours. v2.0.2 paced the calls and retried failed windows, but the first tick after its deploy was again rate-limited by the background pass.

The formula already does what the developer asked for: it tags each vacancy with skills from the static dictionary (`packages/shared/src/skills.ts`) and scores those tags, the title, the grade and freshness against the candidate profile. Its precision on the author's resume is 85% (ADR-026).

## Decision

1. **The owner is scored by the formula like everyone else.** The owner's profile is their `candidate_profiles` row, confirmed or not; without one, `fallbackProfile(resume)` builds it from the resume's terms. The owner keeps the owner-only sources, and cached `resume_matches` scores still help the SQL pre-rank.
2. **The background LLM resume ↔ vacancy pass is removed** from the ingestion `match` job. `POST /matches/resume-score` (the web cabinet's on-demand scoring) stays.
3. **The LLM is called for resumes only on the delivery path.** Owner-only LLM-per-action features (`/interview`, `/plan`, cover letters, `/gmail` apply drafts) are user-initiated and stay.
4. The owner's 👍/👎/hide presses move the feedback weights when a stored profile exists, as for other users.

The developer chose this on 2026-10-16: "make it a keyword-library algorithm so the filter always works, use the LLM only for the resume".

## Consequences

- Delivery no longer depends on a free LLM tier: no rate limit, outage or token budget can empty a push.
- The owner's cards carry the formula's template note ("Matched: React, TypeScript; missing: GraphQL") instead of an LLM sentence.
- `resume_matches` stops growing, so `formula:check` (ADR-026) measures against the scores already collected (230+ pairs on 2026-10-15). A new precision check needs fresh LLM scores, e.g. from the web cabinet's on-demand scoring.
- Formula misses are fixed in the dictionary and the formula (ADR-026 §3), now for the owner as well.
- The v2.0.2 pacing and deferred-window code is gone with the LLM path it protected.
