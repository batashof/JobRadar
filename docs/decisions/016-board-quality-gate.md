# ADR-016: Board quality gate — shared description sanitizer, RemoteOK dropped

- Status: Accepted
- Date: 2026-07-28

## Context

Vacancies from the free job boards arrived polluted. Three distinct problems, all visible in the feed UI:

1. **Board boilerplate as vacancy text.** Every item of the RemoteOK public API carries an anti-spam footer — *"Please mention the word \*\*AMICABILITY\*\* and tag RNzQu… when applying… This is a beta feature to avoid spam applicants…"* — and scraped items carry the source site's cookie banner on top of it. That text landed in `vacancies.description`, so it showed up in the feed, in the resume-matching prompt and in apply-contact extraction.
2. **Items that are not vacancies at all.** A live sample of RemoteOK's `/api` (and of `?tag=dev`) contained **0 IT vacancies out of 100**: municipal pages ("From the Office of the Mayor", "Water and Sewers"), marketing glossary entries, 404 pages, a Lorem-ipsum stub, product descriptions. Half of them had no body beyond the boilerplate above.
3. **Duplicated, lossy HTML handling.** Five workers each had their own `stripHtml`, which replaced *every* entity with a space (`Doctolib&#39;s` → `Doctolib s`) and left UTF-8-read-as-Latin-1 mojibake (`Â£45k`, `childrenâ€™s`) untouched.

At the same time the active board set under-delivered: WeWorkRemotely was polled through its smallest category feed (25 items) while the per-speciality feeds carry an order of magnitude more, and Jobicy was polled for a single industry.

## Decision

1. **One shared sanitizer** — `apps/api/src/ingestion/description.ts` — used by every board worker: entity decoding (named + numeric, double-encoded markup), mojibake repair (Latin-1/CP1252 re-encode, skipped when the text is genuinely non-Latin), and removal of known board boilerplate (RemoteOK anti-spam footer, cookie/privacy banners, stapled-on apply CTAs).
2. **A quality gate at the item level.** An item whose *cleaned* description is under `MIN_DESCRIPTION_LENGTH` (200 characters) is not ingested. Real postings on every active board start at ~1200 characters, so the gate only catches stubs and boilerplate-only bodies. Telegram is exempt — its posts are raw channel text with their own, lower threshold and junk rules (ADR-009).
3. **RemoteOK is deactivated** (`sources.is_active = false`, worker and config kept). Their free API no longer publishes a usable IT job feed; a strict relevance filter would leave ~0 items per run and turn the `empty` alert into permanent noise. Reversible by flipping one flag if their feed recovers.
4. **Compensating volume from better boards**: WeWorkRemotely is polled across five category feeds, Jobicy across two industries (both workers gained multi-feed support with dedupe), and **Himalayas** (`https://himalayas.app/jobs/api`) joins as a new source — the richest free feed available (annual salary, seniority, employment type, location restrictions).

## Consequences

- Descriptions are clean at the single choke point every source funnels through; no worker re-implements HTML handling.
- The feed loses the RemoteOK slice, which was noise, and gains a larger, denser set of real remote IT postings.
- New boards must pass the same gate, which is a cheap defence against the next feed that degrades the way RemoteOK did.
- The gate is length-based, so a genuinely terse-but-real posting under 200 characters would be dropped. No such posting exists on any active board today; if one appears, the threshold is a single constant.
- Himalayas has no server-side category filter and clamps a page to 20 items, so its worker pages (10 pages ≈ 200 newest postings per run, ~20% of them tech). That is more requests per run than the other boards — still well inside the 4-hour politeness rule.
- Rows ingested before this change are cleaned by a one-off script (`pnpm --filter @jobradar/api cleanup:junk`), which never deletes a vacancy the user has already saved or drafted outreach for.
