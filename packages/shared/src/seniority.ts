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
 * Detects the vacancy's / resume's seniority as the HIGHEST level whose keywords
 * appear. Returning the highest is the safe bias: over-stating a level only
 * spares a vacancy from the filter, never wrongly hides a good one. Null when no
 * level word is present at all — such rows always pass the filter.
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

/** Levels a resume at `resumeLevel` considers too junior to be worth showing. */
export function levelsBelowResume(resumeLevel: SeniorityLevel): SeniorityLevel[] {
  const threshold = seniorityRank(resumeLevel) - SENIORITY_FILTER_GAP;
  return SENIORITY_LEVELS.filter((l) => seniorityRank(l) <= threshold);
}
