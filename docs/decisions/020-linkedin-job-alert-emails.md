# ADR-020: LinkedIn vacancies from job-alert emails (amends ADR-003)

- Status: Accepted
- Date: 2026-09-30

## Context

LinkedIn is where a large share of remote frontend roles is published, and JobRadar has none of them: ADR-003 rules out automated access, and the browser extension that was to compensate (phase 4) is not built. The developer asked for a LinkedIn bot that searches "without being noticed", from a secondary account.

That route was examined and rejected on its merits, not only because ADR-003 says so:

- A fresh account that searches on a schedule is exactly what LinkedIn's anti-abuse systems flag; restriction and an ID-verification wall typically follow within days. Accounts are linked by browser fingerprint, IP and phone, so a bot run from the same home network puts the main account at risk too.
- Fake profiles are explicitly prohibited by the LinkedIn User Agreement; in *hiQ Labs v. LinkedIn* (2022) this — not scraping public data as such — is what the court held to be a breach.
- Ingestion runs from GitHub Actions → Render, i.e. datacenter IPs, which LinkedIn answers with HTTP 999 / an auth wall. Making it work means residential proxies and an anti-detect browser: paid (ADR-001) and the arms race ADR-003 declined.
- The account would buy nothing: LinkedIn already runs saved searches for its users and emails the results.

## Decision

1. **LinkedIn enters JobRadar through the job-alert emails LinkedIn sends the user.** The user creates Job Alerts on their own, real account (keywords, location, *Remote*, level — LinkedIn's full filter set); LinkedIn mails the matches; a new source worker, `linkedin` (kind `email`), reads those emails from the user's mailbox over IMAP and ingests one vacancy per card. **No request from JobRadar ever reaches linkedin.com.** This is not scraping in the sense of ADR-003 — it is reading mail addressed to the user — so ADR-003's decision stands for everything else: no crawler, no guest endpoints, no logged-in automation, no secondary accounts.
2. **The card is the vacancy.** An alert email carries title, company, location, workplace type and sometimes a salary — no posting body. That is accepted: the apply happens on LinkedIn or the employer's site anyway, and the card is enough to decide whether to open it. The description is synthesized from the card's facts and states that the full posting is on LinkedIn. The ADR-016 quality gate (≥ 200-character description) is a board-scraping rule and does not apply here, as it does not to Telegram.
3. **Identity and dedup.** `external_id` is LinkedIn's numeric job id, `url` the clean `linkedin.com/jobs/view/<id>/` (tracking parameters dropped). Re-reading the same emails is idempotent. Cross-source dedup is the existing ADR-004 heuristic (company + title similarity): a posting already ingested from an ATS board stays canonical and the LinkedIn row links to it.
4. **Parsing anchors on the job link only.** The one stable element of the email is `/jobs/view/<id>`; title, company and location are read relative to it, from the HTML part (primary — it has the salary line) with the plain-text part as a fallback. No class names or table structure are relied on. A window that contains alert emails but yields no job marks the run `empty` (→ Sentry alert): that is the "LinkedIn changed the layout" signal. A window with no alert emails is `notModified` — alerts are daily at best.
5. **Mailbox access is IMAP with an app password, read-only.** The mailbox is opened read-only (nothing is marked as seen), searched by sender in "All Mail" so a filter that archives the alerts does not hide them. IMAP was chosen over the Gmail API already used for sending (ADR-011): a refresh token of an unverified Google app in *Testing* status expires every 7 days, an app password does not. Because an app password opens the whole mailbox, the recommended setup is a **dedicated mailbox** that receives only the forwarded alerts (a Gmail filter on the main account forwards `jobalerts-noreply@linkedin.com`).
6. Politeness and cadence are unchanged: the worker runs with every ingestion cycle (every 4 hours, ADR-006) under the same interval rule, and new cards reach Telegram through the existing digest — instantly in ADR-019's instant mode.

## Consequences

- Easier: LinkedIn vacancies in the feed and the Telegram digest at zero ban risk, zero cost and no terms-of-service exposure; LinkedIn's own filters do the first cut.
- Harder: cards are thin — no description for résumé matching or the digest verdict beyond title, company and location; the fit score is correspondingly coarser. The email layout is LinkedIn's and will change; the `empty` alert and the `linkedin:alerts:preview` script (parses a saved `.eml` or the live mailbox, writes nothing) are how a change is caught and fixed.
- Accepted trade-off: coverage is whatever the user's alerts cover, delivered at LinkedIn's alert cadence plus up to one ingestion interval.
- A secret with read access to a mailbox now lives in the API environment; the dedicated-mailbox setup limits what it can read.
