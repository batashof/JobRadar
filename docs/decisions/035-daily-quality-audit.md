# ADR-035: A daily delivery quality audit with a free LLM as an offline judge

- Status: Accepted
- Date: 2026-10-30
- Amends: ADR-026 (the formula's quality gate), ADR-032 (title families as code)

## Context

Every recent matching fix started with the developer spotting a bad card by hand: an SEO specialist delivered for a frontend resume (v2.6.4, ADR-032), Spanish-only LinkedIn vacancies (v2.7.0, ADR-033). The developer also sees many fullstack vacancies on a frontend resume: the skills match, the job does not. `formula:check` (ADR-026) measures precision only against the LLM scores `resume_matches` collected before ADR-029, so it no longer sees new vacancies, and nothing looks at what the funnel held back.

On 2026-10-30 the developer asked for an agent that checks every day, on their own profile, every vacancy that arrived, delivered or not: is the filter right, is the job family read right. Budget stays $0 (ADR-001) and vacancy scoring stays the formula (ADR-029).

## Decision

1. **A daily GitHub Actions workflow, `quality-audit.yml`** (07:00 Minsk, also manual), runs `pnpm --filter @jobradar/api audit:quality --prod --apply`. No new service, no MCP server, no bot command.
2. **The audit replays the funnel for the author** (`src/audit/decide.ts`): every canonical vacancy ingested in the last 24 h, minus muted sources, through the level gate, the hard preferences, the formula and the floor, with the reason each one was dropped. Pure and tested; it reads the database only.
3. **A free LLM judges a sample** (`src/audit/judge.ts`): GitHub Models through the workflow's own `GITHUB_TOKEN` (`permissions: models: read`), then the app's Groq, Gemini and OpenRouter keys when present. At most 120 vacancies a day in batches of 8, deliveries first, then family and language drops and the ones closest to the floor; drops by the user's own location, format, employment or salary filters are not judged. The judge answers strict JSON (engineering or not, job family, fit 0–100, working language, the title word naming a non-engineering profession, a reason), validated by zod; anything malformed is dropped.
4. **Only public vacancy text and the author's structured profile** (role, grade, skills) are sent. No resume text, no name, no contacts, and no other user's data (ADR-025 §4). Testers' profiles may be added later only after the provider's data terms are checked and `/privacy` says so.
5. **The LLM labels, code decides.** `src/audit/findings.ts` turns disagreements into findings: sent but rated below 40, held back but rated 70 or more. Causes: not an engineering job, another family, fullstack for a frontend profile, working language, grade, skills.
6. **Only dictionary words are fixed automatically.** The title words of the job families move from `score.ts` into `matching/dictionaries/title-terms.json`; `title-cases.json` is their regression set, checked by a spec. A word is added to an existing non-engineering family only when it is in the title as written, is not an engineering word or a technology, makes the title read as that family, changes no regression case and stops no title of the day the judge calls engineering. Each fixed title becomes a regression case.
7. **Rules are the developer's call.** Fullstack for a frontend profile, new families, weights, caps and language reading are reported with examples and never changed by the audit.
8. **Output**: the markdown report in the run summary and a 90-day artifact (`report.md`, `summary.json`), a short Russian summary to the author's Telegram chat, and, when there are fixes, a pull request opened by the workflow after build, lint, typecheck and test pass in the same job (a PR opened with `GITHUB_TOKEN` triggers no CI). The workflow then merges it, and Render deploys `main` (the developer's choice on 2026-10-30: every audit fix ships without review); the repository variable `AUDIT_AUTO_MERGE=false` leaves it for review instead. Audit PRs carry no version bump, the next release lists them.

## Consequences

- Misses of the SEO kind are found the next morning without anyone reading cards, and every fix comes with a test.
- False negatives become visible for the first time: what the formula held back that the judge would have sent.
- The judge is a weak free model. Its verdicts are a signal for the report, never a delivery decision; a wrong word is stopped by the regression set and the collateral check; one that slips through ships at once and is reverted by hand, then becomes a regression case.
- Repository settings: "Allow GitHub Actions to create and approve pull requests" must be on for the PR; an optional `AUDIT_PR_TOKEN` (fine-grained PAT) opens it as a person so CI runs. Groq/Gemini/OpenRouter keys are used only if they are also stored as Actions secrets.
- GitHub Models' free tier is rate limited (requests per minute and per day); 15 requests a day with a pause between them stays inside it, and a spent quota falls over to the next provider.
