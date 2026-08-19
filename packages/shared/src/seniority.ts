/**
 * Coarse seniority classification (ADR-012). Rules-based, no LLM: powers the
 * feed's soft "hide roles clearly below my level" filter, driven by the active
 * resume. Deliberately lenient — unknown level never filters, and we only hide
 * vacancies two-or-more grades below the resume, so the feed never empties out.
 */

export const SENIORITY_LEVELS = ['intern', 'junior', 'middle', 'senior', 'lead'] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

/** Ordinal rank; higher = more senior. */
export function seniorityRank(level: SeniorityLevel): number {
  return SENIORITY_LEVELS.indexOf(level);
}

/**
 * A vacancy is hidden for a resume only when its level is this many grades or
 * more below the resume's. Gap of 2 keeps the adjacent grade (a senior still
 * sees middle roles) while dropping the obvious mismatches (intern/junior).
 */
export const SENIORITY_FILTER_GAP = 2;

// EN + RU keyword signals per level, richest first. Order within the file does
// not matter — detection always returns the highest-ranked level that appears.
const LEVEL_TERMS: Record<SeniorityLevel, string[]> = {
  intern: ['intern', 'internship', 'trainee', 'стажер', 'стажёр', 'стажировка', 'практикант'],
  junior: ['junior', 'jr', 'entry-level', 'entry level', 'джуниор', 'джун', 'младший'],
  middle: ['middle', 'mid-level', 'mid level', 'мидл', 'средний'],
  senior: ['senior', 'sr', 'синьор', 'сеньор', 'старший'],
  lead: [
    'lead',
    'principal',
    'staff',
    'teamlead',
    'team lead',
    'tech lead',
    'techlead',
    'head of',
    'техлид',
    'тимлид',
    'ведущий',
    'руководитель',
  ],
};

/**
 * Word-boundary match, Unicode-aware (RU + EN; a plain `\b` fails on Cyrillic).
 * "lead" must not hit "leadership" or "leads"; multi-word terms match literally.
 */
function hasTerm(term: string, text: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * Detects seniority as the HIGHEST level whose keywords appear anywhere in the
 * text. Suitable for a **résumé**, where the whole document describes one career
 * and the highest level claimed is the level to compare against.
 *
 * Do not run this over a vacancy's full text — see `detectVacancySeniority` for
 * why. Null when no level word is present at all; such rows always pass the
 * filter.
 */
export function detectSeniority(text: string): SeniorityLevel | null {
  if (!text) return null;
  // Walk from most senior down; first hit wins.
  for (let rank = SENIORITY_LEVELS.length - 1; rank >= 0; rank -= 1) {
    const level = SENIORITY_LEVELS[rank] as SeniorityLevel;
    if (LEVEL_TERMS[level].some((term) => hasTerm(term, text))) return level;
  }
  return null;
}

/**
 * Hashtag forms of the level words. Boards that tag their postings —
 * `#удаленка #middle #senior` — are the one place a description states a level
 * outright instead of mentioning it in passing. Multi-word terms are dropped
 * because a hashtag cannot contain a space.
 */
const HASHTAG_TERMS: Record<SeniorityLevel, string[]> = Object.fromEntries(
  SENIORITY_LEVELS.map((level) => [level, LEVEL_TERMS[level].filter((t) => !t.includes(' '))]),
) as Record<SeniorityLevel, string[]>;

function hasHashtag(term: string, text: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`#${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * A vacancy's level, from its **title** — falling back to explicit hashtags in
 * the description, and to nothing at all otherwise.
 *
 * Scanning a whole posting the way `detectSeniority` does looks equivalent and
 * is not: descriptions are prose, and the level words are ordinary English and
 * Russian. "You will lead the team", "our staff of 200", "report to a senior
 * manager", "ведущие клиенты" all read as a level to a keyword matcher. On the
 * production board that mislabelled **45% of all vacancies as `lead`**, and 717
 * postings ended up contradicting the level printed in their own title —
 * "Senior Software Engineer" stored as `lead`. The soft filter (ADR-012) then
 * showed a senior résumé the intern postings it exists to hide, because a
 * junior posting whose body says "senior" outranked its own headline.
 *
 * A title is a statement about the role; a description merely contains words.
 * Where the title says nothing, saying nothing is the honest answer: an
 * unlabelled vacancy always passes the filter, which is the lenient direction
 * the ADR asks for.
 */
export function detectVacancySeniority(
  title: string,
  description?: string | null,
): SeniorityLevel | null {
  const fromTitle = detectSeniority(title);
  if (fromTitle) return fromTitle;
  if (!description) return null;

  for (let rank = SENIORITY_LEVELS.length - 1; rank >= 0; rank -= 1) {
    const level = SENIORITY_LEVELS[rank] as SeniorityLevel;
    if (HASHTAG_TERMS[level].some((term) => hasHashtag(term, description))) return level;
  }
  return null;
}

/** Levels a resume at `resumeLevel` considers too junior to be worth showing. */
export function levelsBelowResume(resumeLevel: SeniorityLevel): SeniorityLevel[] {
  const threshold = seniorityRank(resumeLevel) - SENIORITY_FILTER_GAP;
  return SENIORITY_LEVELS.filter((l) => seniorityRank(l) <= threshold);
}
