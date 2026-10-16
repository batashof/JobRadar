# ADR-028: 2.0.0 ships with the web app kept as the author's cabinet (amends ADR-024)

- Status: Accepted
- Date: 2026-10-16
- Amends ADR-024 §6–7 and closes its open question about the author's web-only tools

## Context

ADR-024 made the Telegram bot the only client and planned to cut `apps/web` down to a static landing page in the last step of phase 5, which is the 2.0.0 release. By the end of phase 5.5 the bot covers everything a job seeker does: registration, resume and profile, matching, every setting, applications with reminders, and for the author `/interview` and `/plan`.

The website still holds tools the bot does not have: editing search profiles, the vacancy page with the brief, cover letter and resume match, funnel statistics, and the kanban board. On 2026-10-16 the developer asked to keep the website for now ("it hangs there and does not get in the way") and release 2.0.0 with everything else.

## Decision

1. **2.0.0 is the bot-only product for job seekers.** Every user-facing flow is in the bot, the docs describe the bot as the product, and new features go only into the bot (ADR-024 §1 unchanged).
2. **`apps/web` stays deployed as it is, as the author's private cabinet.** No new features, no removal of email + password auth, sessions or the web proxy. The bot does not link into it any more: the in-chat apply flow and the planner nudges used to offer "Open in the app" buttons, which are gone; the nudge keeps "📋 Open plan", which opens `/plan` in the chat.
3. **The privacy policy gets a stable public URL on the existing site:** `/privacy` (en/ru, outside the `/app` login guard). The bot's `/privacy` reply links to it, and it is the URL for BotFather.
4. **Gmail is connected from the bot:** `/gmail` (owner only) shows the status, a consent link that carries the signed user id in OAuth `state`, and a disconnect button. Google's callback answers with a small page pointing back to Telegram instead of redirecting into the website.
5. **Removing the website stays a later, separate step**, together with dropping `sessions` and `users.password_hash`. It needs the developer's word, since the author loses the web-only tools listed above.

## Consequences

- Strangers never need the website; the author keeps the tools that have no bot equivalent.
- Two clients are still maintained for the author. The web test suite keeps running in CI, and `WEB_ORIGIN` stays set on Render for CORS.
- A stranger who opens the site's root lands on the author's login page. Acceptable while the bot is shared by direct link and the privacy page is public.
