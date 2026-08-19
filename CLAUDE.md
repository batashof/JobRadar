# CLAUDE.md — JobRadar

This file is the entry point for AI assistants (Claude Code) working on this repository. **Read this file first in every session**, then pull application context from the documents listed below — the docs are the single source of truth about the product, architecture, and current state.

## Language rules

- **Everything in this repository is written in English**: code, comments, commit messages, documentation, issues.
- The developer communicates in Russian in chat; respond in Russian, but produce all artifacts (code, docs, commits) in English.

## Where to get context (read in this order)

1. [docs/PRODUCT.md](docs/PRODUCT.md) — what we are building, for whom, v1.0 scope, what is explicitly out of scope.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, repo layout, stack and why.
3. [docs/ROADMAP.md](docs/ROADMAP.md) — phases and their checklists; **the current phase is marked there**.
4. [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — DB entities.
5. [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — ingestion sources, their limits and politeness rules.
6. [docs/decisions/](docs/decisions/) — ADRs. Do not silently violate an accepted ADR; if a change is needed, propose a new ADR that supersedes it.
7. [docs/WORKLOG.md](docs/WORKLOG.md) — what has already been done, session by session.

## Non-negotiable project constraints

- **Budget is $0** — free tiers only (ADR-001). Never introduce a paid dependency or service.
- **No LinkedIn scraping** in any form (ADR-003).
- **Scraping politeness**: API/RSS-first, min 4-hour intervals, caching, backoff, no proxies (see docs/DATA_SOURCES.md).
- **Backend is a separate service** — do not move backend logic into Next.js API routes (ADR-002).
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
- **Current version: 1.21.0** (vacancy seniority comes from the title rather than the description's prose — ADR-018, 45% of the board was mislabelled `lead`; `/health` reports each LLM provider's last call; the digest card links the original posting, 2026-08-20; keep this line in sync on every bump).
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
- Monorepo layout (once code exists): `apps/web`, `apps/api`, `packages/shared` (ADR-002 / ARCHITECTURE.md).
- Conventional Commits for commit messages (`feat:`, `fix:`, `docs:`, `chore:`, ...).
- Tests and lint must pass in CI before merge.
- **Commit & push — mandatory.** After completing a coherent chunk of work, commit it (Conventional Commits; direct to `main` is fine for this solo project) and push to the remote in the same session. Do not leave finished work uncommitted; no explicit request from the developer is needed.
- **Tests — mandatory for both apps.** Every feature or fix in `apps/web` (frontend, Vitest + React Testing Library) and `apps/api` (backend, Jest) lands together with tests covering it. New code without tests does not count as done.
