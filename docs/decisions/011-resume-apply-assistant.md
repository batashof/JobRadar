# ADR-011: Resume-driven apply assistant (upload, LLM matching, cover letters, email apply via Gmail)

- Status: Accepted
- Date: 2026-07-20

## Context

v1.0 treats a vacancy as a link-out: the user reads it at the source and applies there manually. PRODUCT.md explicitly rejected "in-app apply", meaning *automated* responding on the user's behalf.

In a real job search the tedious part after finding a vacancy is tailoring the application: re-reading the description, figuring out who the employer is, writing a cover letter in the right language and register, finding where to send it, and attaching the right resume. All of this is mechanical enough to assist with, and the project already has an LLM strategy (ADR-005: free tiers, gateway, failover, graceful degradation).

Constraints that shape the design:

- **$0 budget (ADR-001)**: no paid storage, no paid email API, no paid LLM. Free-tier LLM quotas are token-based, so nothing may fan out LLM calls across the whole vacancy table unprompted.
- **Single user (the author)** in v1.x: no multi-tenant storage or quota concerns.
- **No automated applying**: the line we keep is that JobRadar never contacts an employer without an explicit user action.

## Decision

Add a **resume-driven apply assistant** as a phase 4 feature block:

1. **Resume upload (PDF).** The user uploads a resume PDF. Files are stored as `bytea` in Postgres (Neon free tier; single user, files ~100 KB–1 MB — a dedicated object store is not justified under ADR-001). Text is extracted server-side at upload time and stored alongside the file; the extracted text — not the PDF — is what every LLM prompt uses.
2. **Vacancy detail page.** Clicking a vacancy in the feed/matches opens an in-app page with the full stored description (the outbound source link remains available but is no longer the only destination). All assistant actions live on this page.
3. **LLM resume ↔ vacancy matching.** An LLM (via the ADR-005 gateway) scores how well a vacancy fits the resume and produces a short fit explanation. To respect token quotas, LLM scoring is applied only to vacancies that already pass rules-based profile matching, and every result is cached permanently (`resume_matches`); a vacancy is scored at most once per resume.
4. **On-demand Russian vacancy brief.** A button on the detail page generates a short brief in Russian: who the employer is, what they do, and how well the vacancy fits the user. Generated strictly on click (never in batch — token discipline, ADR-005) and cached on the vacancy.
5. **On-demand cover letter.** A button generates a cover letter through the free-LLM gateway. Requirements baked into the prompt: written in the vacancy's language; English proficiency calibrated to the level evident in the resume (never above it); short and dense; foregrounds the user's *real, relevant* experience rather than volume. The user can edit the result before sending.
6. **Contact extraction.** Ingestion extracts an application contact from the vacancy text (email address, Telegram handle, or apply URL — regex first, LLM fallback later) into a structured field. The detail page shows it; an email contact pre-fills the recipient of the application email.
7. **Email apply via Gmail API.** A button composes an application email — subject and body LLM-generated, cover letter included, resume PDF attached — addressed to the extracted contact. Sending goes through the **Gmail API** with OAuth (`gmail.send` scope) from the user's own Google account, so the sender is the user's real address, deliverability is Google's, and the cost is $0. The refresh token is stored server-side. **Nothing is sent without the user reviewing the draft and explicitly confirming.**

This **revises the "in-app apply" rejection in PRODUCT.md**: user-initiated, user-confirmed email applications from the vacancy page are now in scope. Fully automated applying (any application sent without an explicit per-vacancy user action) remains rejected.

## Consequences

- Easier: the apply loop (read → research employer → write letter → find contact → send) collapses into a few clicks; cover letters stay consistent with the actual resume; applications are traceable in the CRM.
- Harder: Google OAuth verification hoops for the `gmail.send` scope (test-mode app with the author as a test user is acceptable for v1.x); PDF text extraction quality varies; contact extraction will miss or mis-parse contacts (the recipient field stays editable); LLM output quality varies across free providers (ADR-005 trade-off, accepted).
- Accepted trade-offs: resumes as `bytea` in Postgres would not scale to many users — acceptable for a single-user product, revisit with multi-tenancy (phase 5); on-demand-only generation means no precomputed briefs/letters — acceptable, it is exactly what keeps free-tier quotas alive.
