# Architecture Decision Records

Numbered, immutable records of significant decisions. To change a decision, add a new ADR that supersedes the old one — do not edit accepted ADRs.

## Index

| # | Title | Status |
|---|---|---|
| [001](001-zero-budget.md) | Zero-budget constraint: free tiers only | Accepted |
| [002](002-separate-backend.md) | Backend as a separate service | Accepted |
| [003](003-no-linkedin-scraping.md) | No LinkedIn scraping | Accepted |
| [004](004-dedup-heuristic-first.md) | Deduplication: heuristic first, LLM later | Accepted |
| [005](005-llm-free-tier-failover.md) | LLM via free tiers with provider failover | Accepted |
| [006](006-github-actions-cron.md) | External cron via GitHub Actions | Accepted |
| [007](007-api-hosting-render.md) | API hosting on Render free tier | Accepted |
| [008](008-orm-drizzle.md) | ORM — Drizzle | Accepted |
| [009](009-drop-hh-telegram-primary.md) | Drop hh.ru; Telegram job channels as the primary source | Accepted |
| [010](010-sentry-error-monitoring.md) | Sentry for error monitoring on both apps | Accepted |
| [011](011-resume-apply-assistant.md) | Resume-driven apply assistant (upload, LLM matching, cover letters, Gmail apply) | Accepted |
| [012](012-feed-resume-relevance.md) | Feed-centric resume-driven relevance (remove Matches page, on-demand fit gauge, soft seniority filter) | Accepted |
| [013](013-interview-prep-module.md) | Interview-prep module (resume-driven plan, generated Q&A, LLM-reviewed live-coding, text mock interview) | Accepted |

## Template

```markdown
# ADR-NNN: Title

- Status: Proposed | Accepted | Superseded by ADR-MMM
- Date: YYYY-MM-DD

## Context
What situation forces a decision.

## Decision
What we decided.

## Consequences
What becomes easier, what becomes harder, what we accept as a trade-off.
```
