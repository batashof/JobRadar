# ADR-037: A bug and feedback inbox, triaged daily in Telegram, fixed by a scheduled Claude Code session

- Status: Accepted
- Date: 2026-10-30
- Amends: v2.6.0 error alerts and `/feedback` (feedback text is now stored); ADR-025 §4 (`/privacy` wording)

## Context

Since v2.6.0 every failure a user hits is an `error` event plus an instant alert in the owner's chat, and `/feedback` is forwarded to that chat and not stored. Both scroll away: nothing keeps a list of what is still broken or asked for, and every fix starts with the developer copying a Telegram message into a chat with Claude.

On 2026-10-30 an alert read `button s:open — answerCallbackQuery failed: fetch failed`: Node's fetch lost the connection to Telegram while answering a button press. A transient network fault, not a bug, but it still cost the user the screen (the answer threw before the edit) and woke the owner. The developer asked for another agent: errors and feedback collected into one list of tasks, the list once a day in Telegram, the owner marks what to fix, and the fixes happen on their own.

Budget stays $0 (ADR-001): no paid Anthropic API. The developer already works through Claude Code sessions on a subscription.

## Decision

1. **One inbox table, `reports`** (migration `0027`). An error is one row per fingerprint (the update label plus the message with ids and numbers normalised) with a counter and last-seen time; each `/feedback` is its own row, keyed to its author with `on delete cascade`. Status: `new` → `fix` (owner pressed 🛠) → `issued` (a GitHub issue exists) → `done` (the issue was closed as completed); or `skip`. A `done` error that occurs again goes back to `new`.
2. **Transient faults are counted, not alerted.** `isTransientError`: network faults (`fetch failed`, `ECONNRESET`, timeouts, a dropped pg connection) and Telegram 429/5xx. They still land in `events` and `reports`, but send no instant alert, and the triage list shows them only past 5 repeats; below that they are one count line. Real failures keep the instant alert of v2.6.0.
3. **The Telegram client tolerates them.** Idempotent Bot API calls (`answerCallbackQuery`, edits, `getFile`, `getMe`, webhook and menu setup) are retried once after a network fault; `sendMessage` is not, since the first copy may have arrived. Answering a button press is best-effort: a lost answer no longer skips the screen edit. Network errors carry their cause (`fetch failed (ECONNRESET)`).
4. **Triage in the bot.** The owner's `/triage` (owner only, in the owner menu) shows the open list: `new` and `fix` items, oldest first, ten at a time, with 🛠 fix / 🙈 skip / ↩️ undo buttons (`t:<action>:<id>`). A press changes the status and redraws the list. Items already `issued` or closed belong to GitHub and cannot be changed from the bot.
5. **A daily `Triage` workflow** (`triage.yml`, `scripts/triage.ts`): at 08:15 and 20:15 Minsk it turns `fix` items into GitHub issues labelled `agent-fix` (plus `bug` or `feedback`) with the workflow's own `GITHUB_TOKEN` (`issues: write`, no new secret), and closes items whose issue was closed. The 08:15 run also sends the open list, rendered by the same function as `/triage`, to the owner's chat when it holds something not shown before. *(Amended 2026-11-01, v2.13.1: the slots moved to 05:41 and 17:41 Minsk, since GitHub started the 08:15 slot up to six hours late; the morning list is sent every day, an empty one as a short "nothing open" line, because silence read as a broken digest; the fixer triggers a sync itself before it looks for issues.)*
6. **The fixer is a scheduled Claude Code session**, not part of this repository's runtime: a task on the developer's claude.ai account starts a fresh session after the evening sync, reads open issues labelled `agent-fix`, and for each one follows CLAUDE.md (cause, fix with tests, worklog, version, PR that says `Fixes #N`, merge when CI is green). It closes an issue that is not a code defect as not planned, with the reason. It runs on the subscription, so the budget stays $0, and its PRs go through the same CI as any other.
7. **Privacy.** The repository is public, so an issue carries no user id or username, and feedback text is redacted (emails, `@handles`, `t.me` links, phone numbers) and published only after the owner presses 🛠. `/privacy` and the web policy say that `/feedback` text is kept until handled or `/delete`, and may be published without the author's name.

## Consequences

- One list of what is broken or asked for, with counts, instead of a chat history; a fix needs one press.
- Network blips stop waking the owner and stop eating button presses.
- A press made after 20:15 waits for the next morning's sync, and the fixer runs once a day; the developer can run the workflow or ask Claude in the project for anything urgent.
- The fixer's quality is that of any unattended session: CI and the merge rule are the guard, and a bad fix is reverted like any other PR. Sessions draw on the developer's Claude subscription limits.
- Feedback text now lives in the database. It is deleted with the account; skipped and done items are not purged yet.
