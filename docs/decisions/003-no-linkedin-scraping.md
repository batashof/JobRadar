# ADR-003: No LinkedIn scraping

- Status: Accepted
- Date: 2026-07-19

## Context

LinkedIn is the richest vacancy source, but it has no public vacancy API, deploys aggressive anti-bot systems, and bans accounts for automation. Fighting it means proxies, fingerprinting evasion, and constant breakage — an endless war that contradicts both the zero-budget constraint (ADR-001) and the gentle-scraping principle.

## Decision

JobRadar will **never scrape LinkedIn automatically**, in any form. Compensation: a browser extension (phase 4) adds a one-click "Save to JobRadar" button that sends the vacancy page the user is currently viewing to the API as a `manual`-source vacancy. The same flow covers Djinni and any other hostile-to-scraping site.

## Consequences

- Easier: no anti-bot arms race, no proxy costs, no account-ban risk, clean conscience re: terms of service.
- Harder: LinkedIn vacancies enter the system only through manual user action.
- Accepted trade-off: the aggregator is not exhaustive; it aggregates friendly sources and delegates hostile ones to the human.
