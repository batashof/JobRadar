/**
 * ADR-025 §9: before the formula judges anyone, it must agree with the LLM on
 * the author's resume — the top N by formula overlaps the top N by the cached
 * LLM score (`resume_matches`) by at least this share.
 */
export const FORMULA_CHECK_TOP_N = 20;
export const FORMULA_CHECK_MIN_OVERLAP = 0.7;

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
  pass: boolean;
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
  return { size, shared, overlap, pass: size > 0 && overlap >= FORMULA_CHECK_MIN_OVERLAP };
}
