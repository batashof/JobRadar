# CLAUDE.md — JobRadar

This file is the entry point for AI assistants (Claude Code) working on this repository. **Read this file first in every session**, then pull application context from the documents listed below — the docs are the single source of truth about the product, architecture, and current state.

## Language rules

- **Everything in this repository is written in English**: code, comments, commit messages, documentation, issues.
- The developer communicates in Russian in chat; respond in Russian, but produce all artifacts (code, docs, commits) in English.

## Docs map — which file answers which question

The docs are the source of truth. Open the one that matches the task instead of re-deriving it from code; search the code only for what the docs do not say.

| Question | Read |
|---|---|
| What are we building, for whom, what is in or out of scope? | [docs/PRODUCT.md](docs/PRODUCT.md) |
| Which phase is current, what is done, what is next? | [docs/ROADMAP.md](docs/ROADMAP.md) (current phase is marked at the top) |
| How the system fits together: services, repo layout, stack, schedulers, the two Telegram integrations, ingestion flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Tables, columns, migrations, dedup rules | [docs/DATA_MODEL.md](docs/DATA_MODEL.md) (migrations live in `apps/api/drizzle/`) |
| Vacancy sources: which are active, their limits, politeness, the normalization contract, rejected boards | [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) |
| Why something is the way it is | [docs/decisions/README.md](docs/decisions/README.md): ADR index with status; one file per decision, `docs/decisions/NNN-*.md` |
| Known risks (free-tier limits, Upstash command budget, parser breakage) | [docs/RISKS.md](docs/RISKS.md) |
| Production operations (DB migrations, Supabase setup) | [docs/runbooks/](docs/runbooks/) and the `DB (prod)` workflow (`.github/workflows/db-prod.yml`) |
| What happened recently and why | [docs/WORKLOG.md](docs/WORKLOG.md) (newest on top; read the first few entries, not the whole file) and [CHANGELOG.md](CHANGELOG.md) |

`docs/original-plan.ru.md` is the historical planning document (Russian), superseded by the files above. Do not silently violate an accepted ADR; if a change is needed, add a new ADR that supersedes or amends it.

## Code map and commands

- `apps/api` — NestJS backend, one folder per module in `src/` (`ingestion`, `vacancies`, `matching`, `digest`, `bot`, `llm`, `resumes`, `candidate`, `outreach`, `interview`, `planner`, …); Drizzle schema and prod DB scripts in `src/db/`. Tests: Jest, `*.spec.ts` next to the code. Deployed to Render (`render.yaml`, auto-deploys `main`).
- `apps/web` — Next.js App Router frontend (`app/`, `components/`, `lib/`). Tests: Vitest + React Testing Library. Deployed to Vercel. Frozen for new features during phase 5 and reduced to a static landing page in 2.0.0 (ADR-024).
- `packages/shared` — types and schemas shared by both apps.
- `.github/workflows/` — `ci.yml` (build, lint, typecheck, test), `ingestion-cron.yml` (every 4 h), `keep-alive.yml`, `db-prod.yml` (manual: `check`, `migrate`, maintenance tasks).
- Local: `docker compose up -d` (Postgres + Redis), `pnpm install`, then `pnpm build && pnpm lint && pnpm typecheck && pnpm test`, the same checks CI runs. No secrets are needed for them.

## Non-negotiable project constraints

- **Budget is $0** — free tiers only (ADR-001). Never introduce a paid dependency or service.
- **No LinkedIn scraping** in any form (ADR-003) — no requests to linkedin.com, no secondary accounts. LinkedIn vacancies arrive only via the job-alert emails LinkedIn sends the user (ADR-021).
- **Scraping politeness**: API/RSS-first, min 4-hour intervals, caching, backoff, no proxies (see docs/DATA_SOURCES.md).
- **Backend is a separate service** — do not move backend logic into Next.js API routes (ADR-002).
- **Product direction (ADR-024, ADR-025)**: JobRadar is becoming a Telegram-bot product for other job seekers (phase 5, release 2.0.0). New user-facing features go into the bot (`apps/api/src/bot` + feature modules), not into `apps/web`, which is reduced to a static landing page in 2.0.0. For non-owners the LLM is called only once per resume upload; vacancy scoring is a formula. LLM-per-action features stay behind the `owner` role.
- **Scope discipline**: do not start phase N+1 features while the current phase is not deployed (see docs/ROADMAP.md).

## Worklog — mandatory

After every working session that changes the repository, **append an entry to [docs/WORKLOG.md](docs/WORKLOG.md)**:

```markdown
## YYYY-MM-DD — short title
- What was done (bullet points).
- Decisions made (link ADRs if any).
- Next step.
```

Newest entries go at the top. Keep entries factual and short.

## Versioning — mandatory

- The application version lives in [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog format, SemVer).
- **Current version: 2.6.0** (2.6.0: the author's `/stats`, link tags, error alerts to the author's chat and `/feedback`; 2.5.2: Telegram posts need a role plus a hiring, section or salary signal, career-service ads dropped; 2.5.1: one full-width Apply button on the vacancy card, the ✅ Applied button removed; 2.5.0: the vacancy card redrawn as icon rows, Apply names the board, a location filter in `/filters`; 2.4.0: `/filters` split from `/settings`, which vacancies vs when, with the resume's role, grade and skills editable; 2.3.0: `/resume`, `/setup` onboarding and the owner's `/testmode` in the bot; 2.2.0: "Send vacancies now" in the bot, `/digest` and a `/settings` button; 2.0.0 released 2026-10-16: the Telegram bot is the product; 2.0.1: every command in the bot menu, clearer /settings buttons; 2.1.0: the owner's vacancies are scored by the formula too, the LLM reads resumes only on the delivery path (ADR-029); the website stays as the author's cabinet (ADR-028), owner-only /gmail; phase 5.5 done: applications in the bot with stage buttons and reminders, owner-only /interview and /plan; phase 5.4 done: DOU, Djinni and SmartRecruiters sources, 17 Telegram channels across stacks, LinkedIn alerts for every user via /linkedin (ADR-027), owner-only sources; bot users get vacancies scored by a formula gated by precision against the LLM (ADR-026), with every delivery setting in `/settings`; keep this line in sync on every bump).
- Bump the version and add a CHANGELOG entry whenever a meaningful, coherent chunk of functionality lands:
  - `0.0.x` — pre-code / scaffolding steps;
  - `0.x.0` — each completed roadmap phase before release;
  - `1.0.0` — the deployed v1.0 scope from docs/PRODUCT.md.
- **Every `package.json` in the workspace carries the same version** as CHANGELOG.md — the root one *and* `apps/api`, `apps/web`, `packages/shared`. They are one application released as one unit, not independently versioned libraries. `apps/api` is the one that matters in production: `GET /health` reports it, so a stale value misreports what is deployed. Check them all on a bump:

  ```bash
  grep -H '"version"' package.json apps/*/package.json packages/*/package.json
  ```

## Keeping docs in sync

Documentation must never lag behind reality:

- Changed the DB schema → update docs/DATA_MODEL.md in the same PR/commit.
- Added/removed a source → update docs/DATA_SOURCES.md.
- Made an architectural choice → add an ADR in docs/decisions/ (next number, use the template in docs/decisions/README.md).
- Finished a checklist item → tick it in docs/ROADMAP.md.

## Development conventions

- TypeScript everywhere, strict mode.
- Conventional Commits for commit messages (`feat:`, `fix:`, `docs:`, `chore:`, ...).
- Tests and lint must pass in CI before merge.
- **Commit, push, merge — mandatory.** After completing a coherent chunk of work, commit it (Conventional Commits), push it on a branch and open a PR in the same session. Once the feature or fix is complete and CI is green, merge the PR yourself: the developer has given standing permission, no explicit request is needed. If the PR adds a migration, apply it with `DB (prod)` → `migrate` right after the merge, since Render deploys `main` automatically.
- **Tests — mandatory for both apps.** Every feature or fix in `apps/web` (frontend, Vitest + React Testing Library) and `apps/api` (backend, Jest) lands together with tests covering it. New code without tests does not count as done.
