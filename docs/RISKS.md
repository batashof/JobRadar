# Known Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Parsers break when a source changes markup/format | High | Ingestion silently stops | Prefer API/RSS sources (structured, stable); `last_run_status = empty` → Sentry alert; per-source isolation so one broken source doesn't stop the rest |
| 2 | Source rate limits / bans | Medium | Loss of a source | Gentle cadence (once per 4h), caching, exponential backoff, honest User-Agent; respect `Retry-After` |
| 3 | Free hosting puts containers to sleep | High | Missed ingestion runs, slow cold starts | External cron via GitHub Actions (ADR-006) doubles as keep-alive; health-check pings |
| 4 | Free LLM tiers exhausted (real limit is tokens/day, not requests/day) | Medium (phase 4) | Scoring/summarization stalls | Failover across providers (Groq / OpenRouter / Gemini — ADR-005); batch scoring; summarize context to cut tokens; degrade gracefully to rules-based matching |
| 5 | Scope creep | High | v1.0 never ships | Hard rule: phase N+1 only after current phase is deployed; "out of scope" list in PRODUCT.md |
| 6 | Free-tier limits change or products shut down | Low | Migration required | All infra choices are commodity (Postgres, Redis, SMTP-like email API) — swappable; no vendor-specific features in core logic |
| 8 | Background schedulers burn the Upstash free-tier command budget (500k/mo) | Medium | Queue-backed background work stalls when the budget runs out | **Hit in practice**: the first `planner:tick` on BullMQ reached ~247k/500k within days — BullMQ's worker polls Redis continuously even when idle. Fixed in v1.10.1 by moving the tick to a plain in-process `setInterval` (no Redis; revised ADR-015 §7). The ingestion worker's own idle polling was then found to be the real steady consumer (BullMQ blocks on Redis 24/7); tuned in v1.10.3 (`drainDelay` 60s, `stalledInterval` 5min → ~12× fewer idle commands). Keep an eye on the Upstash dashboard; if ingestion polling ever creeps up, the same treatment applies where a job doesn't truly need a distributed queue |
| 7 | Author burnout / life happens | Medium | Project stalls | Small deployable phases; each phase leaves the project in a usable, resume-worthy state |

Review this table at the end of each phase; add new risks as they surface.
