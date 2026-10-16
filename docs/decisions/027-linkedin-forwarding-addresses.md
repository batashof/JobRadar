# ADR-027: Every bot user forwards their own LinkedIn job alerts to a personal plus address (amends ADR-021)

- Status: Accepted
- Date: 2026-10-15
- Amends ADR-021

## Context

ADR-021 brought LinkedIn vacancies in through the job-alert emails LinkedIn sends the user, read over IMAP from one dedicated mailbox (`ALERTS_IMAP_USER`). Only the owner's alerts reach that mailbox, so the `linkedin` source is `ownerOnly` (roadmap 5.4) and the bot's other users never see LinkedIn at all, although LinkedIn is where many of their vacancies are.

Every user already gets LinkedIn alerts in their own inbox. The alerts are the user's own email: forwarding them to JobRadar is the user's choice about their own mail, and no request goes to linkedin.com (ADR-003 stays intact).

## Decision

1. **Personal address.** Each user gets `<local>+<token>@<domain>`, a plus address of `ALERTS_IMAP_USER`. The token is 12 lowercase base32 characters from `crypto.randomBytes`, stored in `users.alerts_token` (nullable, unique) and generated the first time the user opens `/linkedin`. Plus-addressed mail lands in the same mailbox, and the full address stays in Delivered-To / X-Original-To / To.
2. **`/linkedin` in the bot** shows the address and the steps: create job alerts with email notifications on LinkedIn; in Gmail add the address under Settings → Forwarding and POP/IMAP; create a filter `from:jobalerts-noreply@linkedin.com` → Forward to it; with other mail services, use a redirect rule that keeps the original sender. It also says the vacancies are shown only to the user and how many arrived from their alerts in the last 14 days. Without `ALERTS_IMAP_USER` it says the feature is unavailable.
3. **Ingestion.** The `linkedin` worker reads alerts as before; Gmail's filter forwarding keeps the original From, so the same FROM search finds forwarded alerts. Each message's recipients are collected and the token in a plus address of the mailbox names the user. The vacancies of a user's alerts are upserted as usual and linked to that user in a new table `vacancy_recipients (vacancy_id, user_id)`. Mail to the bare address, or to a token nobody holds, is the owner's, as before.
4. **Delivery.** `linkedin` stays `ownerOnly`, which now means "not shared between users": a formula-scored user receives an owner-only vacancy only when `vacancy_recipients` addresses it to them. `/settings` lists the LinkedIn source to a user who has a token, so they can mute it.
5. **Confirmation relay.** Gmail asks the owner of a forwarding address to confirm it by mailing a code to that address, i.e. to our mailbox. The worker also searches for `forwarding-noreply@google.com`, parses the code (and the confirmation link, if any) and sends it to the user in the bot, in their language. `users.alerts_confirmation_code` holds the last code delivered, so each code is sent once; a send that did not land is retried on the next run.

## Consequences

- Any bot user can get LinkedIn vacancies without JobRadar touching LinkedIn and without a second mailbox: one Gmail, one IMAP session per run, as in ADR-021.
- The dedicated mailbox's address is visible to every user who opens `/linkedin`. It receives only mail; the IMAP password stays private.
- Tokens are unguessable (60 bits), but anyone who knows a token can send mail to it. Only messages from LinkedIn's alert sender are parsed, and they only add vacancies to that one user's feed, so a leaked token can at worst add LinkedIn-looking vacancies to the feed of whoever leaked it. Accepted.
- The user's forwarded alerts and the code Gmail sends stay in the dedicated mailbox; `/privacy` says JobRadar reads those emails. Deleting the account removes the token and every `vacancy_recipients` row (cascade); the emails age out of the lookback window and are never read again.
- Only From-preserving forwarders work: a "forward" that rewrites the sender to the user's own address is not matched by the FROM search. Gmail filters preserve it; other providers need a redirect rule, which the instructions say.
- One mailbox and one `maxMessages` cap per run now serve every user. At 10-minute runs (ADR-023) that is ample for now; if the cap is ever hit, older messages in a burst are skipped, which shows up as fewer user-addressed vacancies in the run log.
