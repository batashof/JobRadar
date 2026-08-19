# ADR-017: Résumé-lexical pre-ranking as the always-present relevance signal

- Status: Accepted
- Date: 2026-08-20
- Relates to ADR-005 (token budget), ADR-011 (`resume_matches`), ADR-012 (résumé-driven relevance), ADR-015 §4 (digest funnel)

## Context

Everything that ranks vacancies for a user needs something cached first:

- `profile_matches` needs an active **search profile** the user hand-tuned;
- `resume_matches` needs an **LLM call that already happened** for that exact resume × vacancy pair.

An account can easily have neither. The author's own does: no search profile (ADR-012 removed the surface that made profiles worth maintaining), and `resume_matches` held 2 rows against a 2 643-vacancy pool. Both digest ranking signals were therefore 0 for every candidate, and the ordering silently fell through to `published_at desc`.

The consequences were invisible and expensive:

1. **The digest went quiet for three days** (2026-08-17 → 08-20). It handed its one LLM call the 30 *newest* postings on the board — product managers, designers, DevOps and support roles for a frontend résumé — which the model correctly scored 0–30, all below the user's floor of 60. Meanwhile 192 frontend vacancies sat unseen in the same pool. The user saw "Сегодня ничего стоящего", which is also what a genuinely quiet day looks like.
2. **`resume_matches` could never fill up.** The batch scorer that populates it was itself gated on `profile_matches` × active `search_profiles` — the same gate v1.19.1 removed from the digest, left behind in the matching service. No profile meant no scoring, forever, which is why the cache the digest wanted to rank on was empty in the first place.

This is the third instance of one failure mode: **a narrowing signal used as an entry condition, failing silently as "nothing found"** (v1.19.1 was the first, this ADR covers the second and third). The pattern deserves a rule rather than another point fix.

## Decision

Introduce a **lexical résumé relevance score**, computed in SQL from the résumé the user already uploaded, as the signal that always exists.

1. **Term extraction** (`apps/api/src/matching/resume-terms.ts`, pure). A résumé yields two closed-vocabulary lists: *role families* (frontend, backend, devops, data, …), each expanded to the title words postings actually use, and *technologies*, capped at the 12 most-mentioned. A closed dictionary is deliberate — free-text extraction turns "experience" and "remote" into signals that match every posting ever written.

2. **Family dominance.** A family counts only when it is mentioned at least half as often as the strongest one. A frontend résumé that says "worked with the DevOps team" once must not inherit the whole infrastructure vocabulary — measured on real data, it took two thirds of the batch.

3. **Scoring in SQL**, word-boundary matched (`~*` with `\y`, the same semantics `match-logic.ts` uses in JS): role term in the title (3) + technology in the title (2) + technology in the first 4 000 characters of the description (1), normalised to 0..1. No index, no tokens; ~600 ms over a 14-day pool of 2 640 rows.

4. **It ranks, it never rejects.** `rankScore` takes the *max* of the three signals — rules, cached résumé match, lexical — so they stay alternatives on one scale rather than addends. A vacancy matching no term still reaches the LLM when the pool is small enough.

5. **The same ordering pays for ungating the résumé batch scorer.** `ResumeMatchingService` now reads the feed's own population (canonical, unscored, last 30 days) instead of profile-matched rows, ordered by lexical relevance. Ungating without it would spend a free-tier budget of ~10 calls per run on whatever was posted last.

**The general rule this establishes:** a signal that requires prior state — a profile, a cached score, a previous run — may rank candidates but must never be the sole gate or the sole ordering input. Every ranked read needs one input that exists on a cold account.

## Consequences

- Easier: a brand-new account gets a relevant digest on its first run, with no profile and no warm cache; the LLM's one call per digest is spent on plausible vacancies, which raises the yield of a fixed token budget; `resume_matches` finally accumulates, so the cached signal the design always assumed will exist actually starts existing.
- Easier to diagnose: an empty digest now logs its candidate count, best score and floor. All three silent failures above would have been one log line.
- Harder / accepted: the term dictionary is a maintained list and will lag new technologies — it degrades to "no lexical signal", never to a wrong rejection. Lexical relevance is genuinely dumber than the LLM: it cannot tell a React role from a React Native one. That is fine for a pre-filter whose only job is to get the right 30 rows in front of the model.
- Accepted: ordering by a computed expression is a sequential scan of the candidate window. Measured at ~600 ms on the production pool; the description scan is capped at 4 000 characters to keep it bounded as the board grows.
