# ADR-036: A fullstack title in a backend language the frontend candidate lacks is not delivered

- Status: Accepted
- Date: 2026-10-30
- Amends: ADR-025 §5 (the formula), ADR-032 (title families)

## Context

The first full quality audit (ADR-035) on 2026-10-30 rated 59% of the author's deliveries a fit. Four of the sixteen misses were fullstack roles on a frontend resume: "Full-stack Python Developer (Django + HTMX)", "Senior Full-stack Engineer (backend-heavy)" and similar. A fullstack title is compatible with a frontend candidate (ADR-032), so the React and TypeScript in the description carried them over the floor.

The developer set the rule: a fullstack job whose main language is a backend one the candidate does not have (Python, Java, …) is not wanted; a fullstack job on Node.js is close to frontend and stays; once the candidate adds that language to their skills, such jobs are wanted again.

## Decision

1. **For a candidate whose role reads as frontend**, a vacancy title that names a non-JavaScript server-side stack (`BACKEND_STACK_SKILLS` in `score.ts`: Python, Django, Flask, FastAPI, Java, Spring, Kotlin, Scala, Go, Rust, C#, .NET, PHP, Laravel, Symfony, Ruby, Rails, Elixir) is capped at `WRONG_FAMILY_CAP` (30), below every min-fit preset. `VacancyScore.cap` is `'stack'`.
2. **The cap does not apply** when the title also names the frontend family ("Frontend Developer, Python a plus"), names a JavaScript server side (Node.js, NestJS, Express, Deno, Bun), or the candidate's skills hold that language or a related one from the skill dictionary (Python for Django, Java for Spring).
3. **Only the title counts.** A description that mentions Python among many technologies does not make the job a Python job; generic titles ("Senior Software Engineer") with a backend-heavy description are left to the skill overlap for now.
4. **Other candidate families are unchanged.** A backend or fullstack candidate's scoring stays as it was; the rule can be widened once the audit shows the need.
5. The audit reports the drop as `foreign-stack`; a judge who rates such a vacancy a fit is reported as the developer's rule (`stack-policy`), not as a formula bug.

## Consequences

- Python, Java, .NET, PHP and Go fullstack roles no longer reach a frontend digest; Node.js fullstack roles do.
- A frontend user who also writes Python gets those roles by adding Python in `/resume` (the card's `+Skill`).
- Generic "Software Engineer" titles with a backend body are still a known miss; the daily audit keeps counting them.
