# ADR-013: Interview-prep module (resume-driven plan, generated Q&A, LLM-reviewed live-coding, text mock interview)

- Status: Accepted
- Date: 2026-07-21

## Context

After finding a vacancy (feed) and applying (apply assistant, ADR-011), the next tedious stage of a job search is **preparing for interviews**: figuring out what to revise, drilling theory and behavioural questions, practising live-coding, and rehearsing the interview itself. Today the author does this ad hoc across scattered tools.

The developer initially considered a **separate application** for this, but explicitly does not want to stand up new infrastructure again. The existing JobRadar backend already has everything this needs:

- an **LLM gateway** with ordered free providers, failover, and graceful degradation (ADR-005), already used on-demand and cached (ADR-011/012);
- **resumes in Postgres** with server-side extracted text (ADR-011) — the natural input for a personalised prep plan;
- a monorepo with a NestJS API + Next.js web already deployed (ADR-002/007).

So this lands as another **phase-4 extension module inside JobRadar**, reusing the same apps, DB, and LLM gateway — no new service, no new infra.

Constraints that shape the design:

- **$0 budget (ADR-001)**: no paid LLM, no code-execution sandbox, no speech services. Free-tier LLM quotas are token-based, so nothing may fan LLM calls out over a whole table unprompted — everything is generated **on user action** and **cached**.
- **No new infrastructure**: no sandbox/runner, no realtime voice pipeline. Live-coding is **reviewed by the LLM, not executed**; the mock interview is **text chat**, not voice.
- **Single user (the author)** in v1.x: no multi-tenant quota concerns.

## Decision

Add an **interview-prep module** (`interview/` on the API, `/app/interview` on the web) as a phase-4 feature block. It is **standalone and resume-driven** — anchored to the user's active resume plus an optional target role / seniority / focus, **not** tied to a specific vacancy or kanban card. Five sub-features, all through the ADR-005 gateway, all on-demand and cached:

1. **Prep-plan generation.** From the active resume (extracted text) plus optional target role, seniority, and focus areas, the LLM produces a structured study plan: ordered *sections* → *topics*, each topic with a stable key, a title, and a short "why it matters". Stored once (`interview_plans.structure` jsonb); regenerating is an explicit action. One active plan per user; older ones are kept as history.

2. **Progress tracking.** Per-topic status (`todo` / `in_progress` / `done`) and an optional self-confidence rating are persisted (`interview_topic_progress`) so the plan doubles as a checklist that survives across sessions. Mock-interview and answer history contribute to the same progress picture.

3. **Question generation + model answers.** For any topic the user can generate interview questions — `theory`, `behavioral`, or `coding` — at a chosen difficulty. Questions are cached (`interview_questions`); the reference/model answer is generated **only when the user asks to see it** (extra token discipline) and cached alongside.

4. **Live-coding tasks, LLM-reviewed (no execution).** A `coding` question is a task statement. The user writes the solution in an editor/textarea and submits it; the LLM reviews it for **correctness, complexity, edge cases, and style** and returns structured feedback + a score. **No code is executed** — there is no sandbox (ADR-001, "no new infra"). Each submission and its review are stored (`interview_answers`).

5. **Mock interview (text chat).** The LLM plays an interviewer in a turn-based **text** dialogue calibrated to the resume + target role/seniority: it asks questions, reacts to answers, and follows up. On completion it produces a written feedback report (strengths, gaps, per-area notes, a recommendation). The full transcript and feedback are stored (`interview_sessions`).

Data model: new tables `interview_plans`, `interview_topic_progress`, `interview_questions`, `interview_answers`, `interview_sessions` (see DATA_MODEL.md, migration to follow). All reference `users` (and, where relevant, the `resumes` row a plan was built from). The module reuses `llm/` and `resumes/`; it adds no new external dependency.

## Consequences

- Easier: interview prep becomes a first-class, resume-personalised loop inside the same app the user already job-hunts in; progress and history persist; no context-switching to separate tools; zero new infrastructure or cost.
- Harder: LLM-only live-coding review cannot *run* code, so it can occasionally misjudge correctness on tricky inputs — acceptable as a study aid, and honest about being one (revisit a sandbox only if the zero-budget constraint ever relaxes). Question/answer quality varies across free providers (the ADR-005 trade-off, already accepted). A resume-derived plan is only as good as the extracted resume text (ADR-011 caveat).
- Accepted trade-offs: **no code execution** and **no voice** — both deliberately out of scope to honour ADR-001 and "no new infra"; they can become a later ADR if ever justified. On-demand-only generation means nothing is precomputed — which is exactly what keeps free-tier LLM quotas alive (consistent with ADR-011/012).
- Scope discipline: this is a **phase-4 extension**, planned and started only after v1.0 is deployed (it is). It does not alter v1.0 scope.
