# ADR-032: A vacancy's working language is read from its text, and /filters can hide other languages

- Status: Accepted
- Date: 2026-10-29
- Amends: ADR-025 §5 (the hard preferences before scoring)

## Context

On 2026-10-29 the developer received LinkedIn vacancies written entirely in Spanish, with an apply page in Spanish and no word about English. Nothing on the card said so, and nothing in `/filters` could keep them out. The developer works in English and Russian; the bot's audience reads English, Russian and Ukrainian, and DOU and Djinni post in Ukrainian.

The LLM may not judge vacancies (ADR-025, ADR-029), and LinkedIn may not be fetched (ADR-003): a LinkedIn alert carries only a title, a company and a place, and its stored description is a summary JobRadar writes in English (ADR-021).

## Decision

1. **Detection is a pure function**, `apps/api/src/matching/work-language.ts`, run at delivery on every candidate. Nothing is stored, so a better word list applies to every vacancy at once and no backfill is needed.
   - *Written in*: per language, the count of its function words and a few posting words ("ищем", "buscamos", "wir", "nous") in the title and the first 4,000 characters. Job titles in another language ("Desarrollador", "Entwickler (m/w/d)", "Développeur (H/F)", "разработчик") count three. English titles count nothing, because they head postings in every language. At least three hits name a language. A second language with 40% of the first one's hits also counts (a bilingual post). Russian and Ukrainian are told apart by words that differ ("что"/"що", "и"/"і").
   - *Required*: a language's name, as postings in the ten languages spell it, next to a level or a "required" ("fluent German", "inglés C1", "знание польского обязательно", "Deutschkenntnisse", "French-speaking"). A clause with "a plus" / "будет плюсом" / "von Vorteil" does not count.
   - Ten languages: en, ru, uk, es, de, fr, pt, it, pl, nl. A post in any other language, or with too little text, reads as unknown.
   - A LinkedIn alert is read from its title only.
2. **The card shows it**: a `🗣 Spanish, English` row (written-in languages first) whenever anything was detected.
3. **`/filters` → 🗣 Languages** (`digest_settings.work_languages`, migration `0026_work_languages`): the languages the user can work in, as checkboxes, plus "Any language". A vacancy is dropped before scoring when it is written only in other languages, or requires a language outside the list. An unknown language passes, as an unknown format or salary does. The default is `{en,ru,uk}`, for existing accounts as well; an empty list means any language.

## Consequences

- Vacancies written only in Spanish, German and the like stop arriving by default, and every other card names its language.
- A LinkedIn vacancy with an English title and a Spanish body still arrives, because only the title is known; its card shows no language. Only reading the posting would fix that, and ADR-003 rules it out.
- A wrong guess hides a vacancy silently. Detection needs three hits, unknown passes, and the requirement rule needs a level word next to the name, all to keep that rare; users who want everything pick "Any language".
- Ukrainian is on by default although the developer did not name it, so DOU and Djinni keep arriving; one tap turns it off.
