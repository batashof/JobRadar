# ADR-005: LLM features via free tiers with provider failover

- Status: Accepted
- Date: 2026-07-19

## Context

Phase 4 plans LLM features: vacancy relevance scoring against the user's profile, description summarization, and parsing of semi-structured sources (HN Who's Hiring). Paid API usage violates ADR-001. Free tiers exist (Groq, OpenRouter free models, Google Gemini free tier) but their real constraint is **tokens per day**, not requests per day — a single burst of long job descriptions can exhaust a day's quota.

## Decision

- All LLM calls go through a single internal gateway module with an ordered provider list (e.g. Groq → OpenRouter → Gemini) and automatic failover on rate-limit/quota errors.
- Token discipline: summarize/truncate inputs before scoring; batch multiple vacancies per prompt where quality allows; cache results permanently (a vacancy is scored once per profile).
- Every LLM feature must degrade gracefully: if all providers are exhausted, the system falls back to rules-based matching and unsummarized descriptions — never blocks core flows.

## Consequences

- Easier: $0 LLM costs; provider outages/quota resets don't break the product.
- Harder: gateway plumbing, prompt compatibility across models, variable output quality between providers.
- Accepted trade-off: lower and less consistent quality than a paid frontier model; acceptable because LLM features are enhancement, not core.
