# ADR-004: Deduplication — heuristic first, LLM later

- Status: Accepted
- Date: 2026-07-19

## Context

The same vacancy appears on multiple boards with slightly different titles and company spellings. Showing duplicates ruins the feed and double-counts in statistics. LLM-based matching would be most accurate but burns scarce free-tier tokens (ADR-001, ADR-005) and adds a dependency to the critical ingestion path.

## Decision

v1 deduplication is a pure heuristic:

1. Normalize company names (lowercase, trim, strip legal suffixes).
2. Candidate window: same normalized company, published within ±14 days.
3. Fuzzy title match (trigram similarity / Levenshtein ratio above a threshold tuned on real data).
4. Earliest-ingested vacancy is canonical; duplicates get `canonical_vacancy_id`.

LLM-assisted matching may be added in phase 4 as a *second pass* for pairs the heuristic scores as borderline — never as a replacement for the heuristic in the hot path.

## Consequences

- Easier: deterministic, free, testable with fixtures; ingestion has zero external dependencies.
- Harder: misses duplicates with rephrased titles or differently-spelled companies.
- Accepted trade-off: some duplicate leakage in v1; measured and revisited with real data.
