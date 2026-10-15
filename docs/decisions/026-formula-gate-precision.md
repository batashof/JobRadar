# ADR-026: The formula's quality gate measures precision against the LLM, not top-20 overlap (amends ADR-025 §9)

- Status: Accepted
- Date: 2026-10-15
- Amends ADR-025 §9

## Context

ADR-025 §9 required the formula's top 20 to overlap the LLM's top 20 (`resume_matches`) by at least 70% on the author's resume before the formula serves other users.

The first `formula:check` on prod (230 LLM-scored vacancies) gave 3/20 = 15%. Both lists were almost entirely senior React frontend roles. The LLM gave about 50 vacancies a score of 90–95, so which 20 of those 50 land in its top is close to chance, and two good rankers barely overlap. The metric punished the formula for ties inside the LLM's own scale, not for bad picks.

What a user sees is the formula's top: the question is whether those vacancies are good, not whether they are the same ones the LLM would have picked first.

## Decision

1. **Gate metric: precision.** The share of the formula's top 20 that the LLM rated at least 80 (`FORMULA_CHECK_GOOD_FIT`). Exit criterion: **≥ 70%** on the author's resume.
2. Top-20 overlap stays in `formula:check` output as a diagnostic, not a gate.
3. Formula misses found by the check are fixed in the dictionary and the formula, and the check is rerun after each fix.

The developer chose this on 2026-10-15, after the first run.

## Consequences

- First measurement: precision 85% (17/20), so the formula passes and keeps serving non-owners (it had been switched on together with phase 5.3, ahead of the gate).
- Precision does not see good vacancies the formula ranks low (recall). Users still get every vacancy above their minimum fit, so a good vacancy ranked 25th is still delivered; a low-ranked one below the floor is the remaining risk, tracked in docs/RISKS.md.
- The three misses of the first run (a Vue role, a Portuguese middle role "Pleno", an AEM role) led to v1.28.1: a title naming a framework none of the candidate's skills cover keeps half its title credit, "pleno" reads as middle, and AEM is in the dictionary.
