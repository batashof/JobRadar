# ADR-018: A vacancy's seniority comes from its title, not from its prose

- Status: Accepted
- Date: 2026-08-20
- Amends ADR-012 §3 (the detection rule only; the soft filter itself is unchanged)

## Context

ADR-012 stores a coarse level on `vacancies.seniority`, detected at ingestion by keyword rules over **title + description**, taking the highest level whose keywords appear. The bias was deliberate: over-stating a level only spares a vacancy from the filter.

On real data the rule does not degrade gracefully, it inverts. A description is prose, and every level word is also an ordinary English or Russian word: *"you will **lead** the team"*, *"our **staff** of 200"*, *"report to a **senior** manager"*, *"**принципиально** новый продукт"*, *"**ведущие** клиенты"*. Measured across the 6 252 canonical vacancies in production:

- **2 823 (45%) were labelled `lead`** — against 912 whose titles actually say so;
- **717 postings contradicted the level printed in their own title** — "Senior Software Engineer" stored as `lead`, "Sr. DevOps Engineer" stored as `lead`;
- worse, the inversion ran downward too: **"Junior Front End Development Analyst/Intern" was stored as `senior`**, because its description mentioned senior engineers. It was then delivered in a digest to a senior résumé — precisely the posting ADR-012's filter exists to hide.

Taking the highest level is only a safe bias when each candidate level is evidence *about the role*. Over a whole description it is not evidence at all.

## Decision

`detectVacancySeniority(title, description)` replaces the whole-text scan at ingestion:

1. **The title decides.** A title is a statement about the role; the existing highest-wins rule applies within it, so "Middle/Senior Golang Developer" is `senior` and "Junior … /Intern" is `junior`.
2. **Otherwise, an explicit hashtag in the description** — `#удаленка #middle #senior`. Boards that tag their postings are the one case where a description *declares* a level instead of mentioning one, and a hashtag cannot be prose. This recovers 49 postings, nearly all from the Russian Telegram channels that are the primary source (ADR-009).
3. **Otherwise, nothing.** An unlabelled vacancy always passes the filter, which is the lenient direction ADR-012 asks for — and an honest one: a rules-based classifier that cannot see a level should not invent one.

`detectSeniority(text)` stays as it is and stays the right tool for a **résumé**, where the whole document does describe one career.

Existing rows were relabelled by `backfill:seniority`, which no longer skips rows that already have a level — the premise that a stored level is a correct level is exactly what failed here. It now re-derives every row, writes only the differences, and is idempotent.

## Consequences

- The production board went from 2 823 `lead` labels to 915, and 3 169 rows changed in total: 1 017 `lead → senior`, 1 526 `lead → null`, and 30 postings that had been over-stated down to `junior`/`intern`, where the filter can finally reach them. No row moved *up*.
- Easier: the level shown on a card now matches the title the reader is looking at, which is the only version of it a user can verify.
- Harder / accepted: 3 623 of 6 252 vacancies now carry no level at all (up from 1 998). They all pass the filter, so the cost is a slightly noisier feed for a senior résumé — the same trade ADR-012 already made for unlabelled rows, applied honestly rather than papered over with a guess.
- Accepted: postings that state their level only in the body, without a hashtag, are no longer classified. Recovering those needs an LLM call per vacancy, which the token budget (ADR-005) does not have for a soft filter.
