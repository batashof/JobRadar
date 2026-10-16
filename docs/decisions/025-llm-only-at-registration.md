# ADR-025: The LLM reads the resume once at registration; vacancies are scored by a deterministic formula

- Status: Accepted (§9 amended by ADR-026; §8 amended by ADR-029: the owner is scored by the formula too)
- Date: 2026-10-15
- Amends ADR-005 (provider choice for resume analysis), ADR-011 and ADR-012 (LLM resume ↔ vacancy fit), ADR-020 and ADR-022 (LLM verdict in the digest funnel). All of those stay as they are for the `owner` role (ADR-024)

## Context

Today every vacancy that reaches the digest is judged by the LLM against the resume (ADR-022: batches of 30, up to 200 per send). For one user that fits in free tiers. For many users it does not: the cost grows with users × vacancies, and ADR-001 rules out paying for it.

The developer's concept of 2026-10-15: the LLM is used **only at registration**, to read and evaluate the uploaded resume, and **only free models**. Matching after that works without an LLM, from the criteria the analysis produced.

Most of what rule-based matching needs already exists: hard profile filters (`profile_matches`), the resume-lexical pre-rank (ADR-017), and vacancy seniority from the title (ADR-018). What is missing is a structured candidate profile and a scoring formula.

## Decision

1. **One LLM call per resume upload.** The bot receives a PDF, text is extracted without an LLM (`resumes/pdf-text.ts`), and one call returns JSON validated by a zod schema: target role, grade, years of experience, skills with a weight (`core` / `familiar`), English level, location and timezone, desired salary when stated, and an evaluation of the resume (strengths, gaps, what to add). The result is stored in `candidate_profiles` with the prompt version.
2. **The user confirms the profile.** The bot shows it with buttons; the user fixes mistakes and adds preferences (work format, minimum salary, employment type). Editing is cheaper than another call and catches model errors.
3. **Limits:** at most 3 analyses per user per 30 days (re-uploads). When every provider fails, registration still finishes: a fallback profile is built from the resume's terms (ADR-017) and the analysis is retried later.
4. **Providers for non-owners' resumes exclude free tiers that train on submitted data** (the Gemini free tier does). The chain for resume analysis is Groq → OpenRouter (free models); the owner keeps the full ADR-005 chain. `/privacy` names the provider.
5. **Scoring is a pure function** `matching/score.ts`: `(candidateProfile, vacancy) → { score 0–100, matched[], missing[], reasons }`. Inputs: weighted skill overlap, grade fit (ADR-018), work format, salary, freshness, title keywords. Same input, same output. The explanation is a template: "matched: React, TypeScript; missing: GraphQL; grade: Senior ✓".
6. **Related technologies come from a static dictionary** in `packages/shared` (React ↔ Next.js, Redux ↔ Zustand, JavaScript ↔ TypeScript, …), since a formula does not know that Vue experience is close to React.
7. **Feedback adjusts weights by a simple rule**, no machine learning: 👍 / 👎 / Hide shift skill and company weights within bounds.
8. **The digest funnel for non-owners uses the formula** instead of the LLM verdict: same watermark (`judged_through`), same instant and scheduled modes, same floor setting, now on the formula score.
9. **Quality check before switching:** the formula is compared with the owner's existing LLM scores in `resume_matches`. Exit criterion: on the author's resume, the formula's top 20 overlaps the LLM's top 20 by at least 70%.

## Consequences

- Cost per user is one free LLM call per resume upload. Scoring runs in the API for every user and every vacancy, instantly, for free.
- The formula understands meaning worse than an LLM (seniority hidden in prose, adjacent stacks). The dictionary, title-based grade and feedback weights compensate; the owner can still compare against the LLM.
- The first value a new user sees is the resume evaluation itself, right after upload.
- If all free providers drop a model (Groq did with llama-3.3 in August 2026), registration degrades to the lexical fallback instead of failing.
