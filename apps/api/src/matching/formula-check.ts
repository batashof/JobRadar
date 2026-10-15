/**
 * The formula's quality gate on the author's resume (ADR-026, amending
 * ADR-025 §9): at least this share of the formula's top N must be vacancies
 * the LLM itself rated a good fit in `resume_matches`. Precision asks what a
 * user sees — whether what the formula sends is something the LLM would have
 * sent too.
 */
export const FORMULA_CHECK_TOP_N = 20;
export const FORMULA_CHECK_GOOD_FIT = 0.8;
export const FORMULA_CHECK_MIN_PRECISION = 0.7;

/**
 * The overlap of the two top lists, ADR-025's original gate, is kept as a
 * diagnostic only: it is close to chance when dozens of vacancies share the
 * LLM's top scores.
 */

export interface RankedPair {
  vacancyId: string;
  llmScore: number;
  formulaScore: number;
}

export interface FormulaCheckResult {
  /** How many vacancies each top list holds (less than N when fewer are scored). */
  size: number;
  /** Shared vacancies between the two top lists. */
  shared: number;
  /** shared / size, 0..1. */
  overlap: number;
  /** precision ≥ FORMULA_CHECK_MIN_PRECISION. */
  pass: boolean;
  /** Share of the formula's top N the LLM scored at or above FORMULA_CHECK_GOOD_FIT, 0..1. */
  precision: number;
}

/** Ties break on the vacancy id, so the same input always gives the same top list. */
function top(pairs: RankedPair[], key: 'llmScore' | 'formulaScore', n: number): string[] {
  return [...pairs]
    .sort((a, b) => b[key] - a[key] || a.vacancyId.localeCompare(b.vacancyId))
    .slice(0, n)
    .map((pair) => pair.vacancyId);
}

export function compareRankings(pairs: RankedPair[], n = FORMULA_CHECK_TOP_N): FormulaCheckResult {
  const llm = new Set(top(pairs, 'llmScore', n));
  const formula = top(pairs, 'formulaScore', n);
  const size = llm.size;
  const shared = formula.filter((id) => llm.has(id)).length;
  const overlap = size > 0 ? shared / size : 0;
  const llmScore = new Map(pairs.map((pair) => [pair.vacancyId, pair.llmScore]));
  const good = formula.filter((id) => (llmScore.get(id) ?? 0) >= FORMULA_CHECK_GOOD_FIT).length;
  const precision = formula.length > 0 ? good / formula.length : 0;
  return { size, shared, overlap, pass: formula.length > 0 && precision >= FORMULA_CHECK_MIN_PRECISION, precision };
}
