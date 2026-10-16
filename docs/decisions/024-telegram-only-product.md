# ADR-024: JobRadar becomes a Telegram-bot product for other job seekers; the web app is retired in 2.0.0

- Status: Accepted (§6–7 amended by ADR-028: the web app stays as the author's cabinet in 2.0.0; §3 amended by ADR-029: the owner's vacancies are scored by the formula too)
- Date: 2026-10-15
- Amends ADR-002 (the API keeps its own service; its client changes from Next.js to the Telegram bot), ADR-014 (the interface language follows the Telegram client, not a web setting), ADR-015 and ADR-020 (the bot is no longer a secondary channel next to the web app, it is the only client), and PRODUCT.md (target user and v2 scope)

## Context

JobRadar was built as the author's personal radar: a Next.js web app with email + password accounts, a feed, a kanban board, interview prep and a day planner, and a Telegram bot (ADR-015, ADR-020) that only delivers digests and nudges to an account created on the web.

The developer wants to open it to other job seekers and has chosen Telegram as the whole product, not just a delivery channel (planning thread "План монетизации JobRadar", 2026-10-14/15, and the request of 2026-10-15: "переход с веба на полностью тг бота включая регистрацию через тг, аплод резюме и подбор вакансий под резюме и все настройки"). Reasons:

- **The audience lives in Telegram.** The first segment, Russian-speaking middle/senior developers looking for remote work, already reads job channels there.
- **Shortest path to the first vacancy.** `/start` → send a PDF → vacancies arrive. No signup form, no password, no "link your Telegram" step.
- **The delivery part already works.** Digest cards with Apply / Details / Hide / 👍👎, instant mode, quiet hours and the callback router (`n:`, `d:`, `a:`) are in production.
- **Data is already multi-tenant.** Vacancies are a shared pool; profiles, resumes, digest settings and the chat link are keyed by `user_id`.
- **Payments, if they ever come, can only be Telegram Stars** (cards are out of reach from Belarus). That also points to Telegram. Monetization itself stays deferred (see "Not decided here").

## Decision

1. **The Telegram bot (@JobRadarAppBot) is the only user-facing client.** Every flow the web app offers to a job seeker moves into the chat: registration, resume upload and evaluation, the candidate profile, matching settings, delivery settings, applying, the list of applications, account deletion.
2. **An account is created by `/start`**, keyed by the Telegram user id. `users.email` and `users.password_hash` become optional; `users.telegram_user_id` is unique. No password and no web login for new users. The existing web-account → chat link (`telegram_accounts`) keeps working for the author until the web app is removed.
3. **Roles.** `users.role` is `owner` (the author) or `user`. Features that call the LLM per vacancy or per action (vacancy brief, cover letter, LLM digest verdict, interview prep, planner composition) and features that need the user's own credentials (Gmail send, LinkedIn alerts over IMAP) stay **owner-only** behind this flag. Their code is kept. ADR-025 defines what everyone else gets instead.
4. **Settings live in the chat**: inline keyboards and short dialogs, with the dialog state stored in Postgres (`bot_dialogs`), not in process memory, since Render restarts the process. Callback namespaces extend the existing router: `o:` onboarding, `s:` settings, `p:` profile. The bot module still never imports features (ADR-015).
5. **A Telegram Mini App is not part of 2.0.0.** It would bring back a web surface to build and host. It stays an option after 2.0.0 if chat dialogs prove too clumsy for settings.
6. **The web app is removed in the last phase, which is the 2.0.0 release.** It keeps running until the bot covers everything a job seeker does there, so nothing breaks in between.
7. **A minimal static landing page stays on Vercel**: one page saying what the bot does with an "Open in Telegram" button, plus the privacy policy (the bot links to it from `/privacy` and BotFather). It has no login, no API calls and no user data. Reason: a stranger needs a page to read before sending a resume to a bot, and a privacy policy needs a stable URL. Everything else in `apps/web` (feed, board, resume, profiles, interview, day, login, signup) is deleted.
8. **Personal data rules for strangers' resumes**: `/privacy` (what is stored, which LLM provider sees the resume, for how long), `/delete` (removes the account and everything keyed to it, cascades already exist), and no free LLM tier that trains on submitted data receives a non-owner's resume (ADR-025).
9. **Telegram delivery is rate-limited.** Bot API allows about one message per second per chat and about 30 per second overall. Sends go through one limiter; `429 retry_after` is honoured (already done for one chat in ADR-022), and `403 bot was blocked by the user` turns the user's digest off.

## Not decided here

- **The author's web-only tools** (interview prep, day planner composition UI, kanban drag-and-drop) at the moment the web app is removed: moved into the bot, deleted, or kept as a private cabinet. Asked the developer on 2026-10-15; the default until they answer is to move applications and the mock interview into the bot. The final phase records the answer.
- **Monetization.** Deferred until roughly 100 active users. Running cost per user is one free LLM call at registration (ADR-025), so ADR-001 ($0) holds and nothing needs to be billed.

## Consequences

- One client to build and test instead of two. Frontend work moves from React pages to message rendering and inline keyboards, all tested with Jest in `apps/api`.
- Long or rich screens (a filtered feed, a board) do not fit a chat. The bot shows short lists with paging buttons; a Mini App is the fallback (point 5).
- The author loses web-only tools at 2.0.0 unless the open question above is answered with "move" or "keep".
- Vercel hosts a static page only. `NEXT_PUBLIC_*` API settings, the web proxy and email + password signup go away.
- The number of users is bounded by free tiers: Supabase 500 MB, Render 512 MB RAM, Bot API rate. RISKS.md tracks them.
