# ADR-014: Two-language interface (English / Russian) with account-stored language driving both UI and AI generation

- Status: Accepted
- Date: 2026-07-22

## Context

The app grew up bilingual by accident: navigation and most pages were in English, while the two AI-assistant sections on the vacancy page ("Насколько подходит мне", "Бриф по вакансии") and their LLM output were hard-coded Russian. The developer wants a real, user-controlled choice between **English and Russian** that covers the whole interface **and** the language the AI sections generate in — a Russian interface should produce a Russian brief and a Russian fit rationale; an English interface, English.

Constraints:

- **$0 budget (ADR-001)**: no paid translation service, no i18n SaaS, no extra runtime dependency.
- **Backend is a separate service (ADR-002)**: generation language is decided server-side, so the server must know the user's language.
- **LLM token discipline (ADR-005/011)**: the vacancy brief is cached on the vacancy row and shared across users; the resume-fit score is cached per resume × vacancy. Adding a language must not silently double LLM spend or throw away existing caches.

## Decision

Add a first-class **interface language** (`'en' | 'ru'`), stored on the user account, that drives both UI strings and AI-generation language.

### Storage & source of truth

- New column **`users.language`** (`text not null default 'ru'`). The account is the single source of truth. Default `'ru'` — this is the author's personal tool and the flagship AI sections were already Russian; existing rows adopt the default.
- A non-httpOnly **`jr_lang` cookie** mirrors the account language so server components (including pre-auth `/login` and `/signup`) can render the right language without a DB round-trip. The cookie is written client-side on every switch; it is a cache, never the authority.
- `PATCH /auth/me` (`{ language }`) updates the account; `AuthUser` now carries `language`, so every authenticated request already knows it.

### Frontend

- A tiny **isomorphic dictionary** (`lib/i18n/dictionaries.ts`) with flat dotted keys; `ru` is typed against `en` so the two can never drift (a missing key is a compile error). `translate(lang, key, vars)` does `{name}` interpolation. No i18n library.
- A client **`I18nProvider` + `useI18n()`** seeded from the account language (or the cookie on pre-auth pages, `persist={false}`). Switching is optimistic: it flips local state, writes the cookie, `PATCH`es the account (skipped pre-auth), and calls `router.refresh()` so server components re-render in the new language.
- A `getServerT()` helper resolves the language for server components (dashboard title, `<html lang>`).
- Work-format / employment-type / application-stage / interview-status labels moved from fixed English maps into the dictionary; source names (Telegram, RemoteOK, …) stay as brand names.

### AI generation & caching

- Prompt builders (`buildBriefPrompt`, `buildResumeMatchPrompt`) take a `lang` and have full EN and RU variants. Generation language = the caller's `user.language`, passed from the controllers — no query param.
- The brief is cached **per language** on the vacancy row: the existing `summary_ru` (+`summary_generated_at`) is joined by **`summary_en`** (+`summary_en_generated_at`). Each language fills its own slot on first use; a repeat click in a language already generated is free.
- The resume-fit **score is language-neutral and generated once**; only the rationale is localised. `resume_matches` gains **`explanation_en`** alongside the legacy `explanation` (Russian). The first click in the other language reuses the score and regenerates only the text.
- Feed and vacancy-detail preload the brief / fit rationale for the viewer's language.

## Consequences

- One extra LLM call per vacancy **per language actually requested** — not per user, and never eager. Worst case for a bilingual user is 2× on content they view in both languages; the score is never regenerated.
- `BriefResponse.summaryRu` / `VacancyDetail.summaryRu` were renamed to `summary` (language-agnostic) — the field content now follows the requested language.
- Adding a third language later means: extend the `Language` union, add a dictionary + prompt variant, and add a cache column per LLM-cached artifact. The shape scales but is not free — acceptable for a two-language personal tool.
- Pre-auth pages depend on the `jr_lang` cookie; with no cookie they fall back to the default (`ru`). Authenticated pages always use the account value, so they are always correct.
