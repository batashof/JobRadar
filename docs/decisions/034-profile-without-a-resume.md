# ADR-034: A candidate profile can be set by hand, without a resume

- Status: Accepted
- Date: 2026-10-29
- Amends: ADR-025 §1–2 (the profile comes from one resume analysis)

## Context

Until now the only way into matching was a resume PDF: the bot stored it, sent its text once to an LLM provider (ADR-025 §1, ADR-029) and built the candidate profile from the reply. On 2026-10-29 the developer asked for a way to look for work "anonymously": without uploading a resume, just by parameters. Some job seekers have no up-to-date resume, and some do not want to hand a document with their name, employers and contacts to a bot they have just met.

The scoring formula never needed the resume itself. It reads the profile's role, grade and skills (ADR-025 §5); work format, location, salary and working language are already hard preferences in `/filters` (v2.4.0, v2.5.0, ADR-033). The profile card already lets the user change role, grade, English and skills by buttons and one typed answer.

"Anonymous" here means no resume and no personal data. The Telegram account stays: the chat is the login and the only delivery channel (ADR-024).

## Decision

1. **`/noresume`** (also "✍️ Without a resume" on `/resume` and `/setup`, and a line in the `/start` welcome) builds the profile from four answers: role (the job families of `ROLE_TITLES`), grade, skills typed as a comma list, English level (skippable). Each step edits the same message; the skills answer is the existing `profile` dialog with step `wizard-skills`. The result is the usual profile card, confirmed with "✅ All correct" as before.
2. Such a profile is stored in `candidate_profiles` with `source = 'manual'`, `resume_id = null`, `prompt_version = 0`, no evaluation. No new table and no migration: `source` is a text column.
3. **No LLM call and no file.** The wizard costs no tokens and does not count against the analysis limit (ADR-025 §3). Matching and delivery are unchanged: the digest waits for `confirmed_at` and scores by the formula, exactly as for a profile read from a resume.
4. A profile read from a resume is replaced only after a confirmation, because rebuilding it costs one of the three analyses. Feedback weights survive the replacement (as they do across re-analyses). A manual profile is replaced at once by a resume upload or a new `/noresume`.
5. The manual card has no "🔄 Analyse again" button: there is nothing to analyse.
6. Analytics: `profile_manual_started` when the wizard begins; `profile_confirmed` already carries `source`. `/stats` shows "Set a profile without a resume" in the funnel (profiles with `source = 'manual'`).

## Consequences

- A user can get vacancies without sharing any document; JobRadar then stores only the Telegram ids and the answers. `/privacy` says the resume is optional.
- A manual profile is thinner than an analysed one: no years, no location, no "familiar" skills unless the user lists more than six, no resume review. Ranking is only as good as the skills typed; the formula and the 👍/👎 weights work the same.
- Owner-only resume features (cover letters, email apply, interview prep) still need a resume; nothing changes for them.
