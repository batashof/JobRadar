# ADR-032: Non-engineering titles are another job family; the wrong-family cap drops below every floor (amends ADR-025 §5)

- Status: Accepted
- Date: 2026-10-29
- Amends ADR-025 §5 (the formula's title signal and caps)

## Context

The developer received "Senior SEO Specialist" in the bot with React, TypeScript and JavaScript matched, against a frontend resume. The formula (ADR-025, ADR-029) caps a posting of another job family at 40, but it only knew engineering families (`ROLE_FAMILIES`: frontend, backend, QA, design, …). A title naming none of them read as generic, got 0.3 of the title signal and passed on skills: an SEO posting for a React site names the whole stack, so it scored 86 of 100. The cap itself, 40, also equalled the lowest min-fit preset in `/filters`, so a backend role full of "TypeScript" could still reach a user who set the floor to 40.

## Decision

1. **Titles are classified by `TITLE_FAMILIES`** (`matching/score.ts`): the engineering families of `ROLE_FAMILIES` with title-only words ("QA", "tester", "designer", "analyst"), plus non-engineering families: SEO, marketing, content, sales, HR, support, project management. `ROLE_FAMILIES` stays as it is, because it also reads resume text, where "worked with the marketing team" is not a career.
2. **A non-engineering family counts only when the title has no engineering word** ("developer", "engineer", "разработчик", …), so "Software Engineer, Sales Tools" and "Frontend Developer (SEO-friendly SSR)" stay engineering jobs.
3. **A title of only non-engineering families is off track for any resume not of that family**, including a resume whose role names no family ("React developer").
4. **`WRONG_FAMILY_CAP` is 30**, below the lowest min-fit preset (40): a posting of another job family never reaches a digest or an instant push.

## Consequences

- An SEO, marketing, recruiting or sales posting that lists the candidate's stack scores at most 30 and is not delivered. The card would still list the matched skills if a user lowered the floor below 30 by hand, which `/filters` does not offer.
- The title vocabulary is a closed list, as the skill dictionary is: a new kind of off-track title is fixed by adding its words to `TITLE_FAMILIES`.
- Precision against the LLM (`formula:check`, ADR-026) can only go up for these postings, since the LLM already scored them low on "role".
