/**
 * Free-form salary strings, shared by the sources that publish compensation as
 * prose rather than numbers ("$150k - $230k", "$175,000 - $215,000 USD + equity",
 * "$120 - $170 /hour").
 *
 * Only clear *annual* figures are mapped. Hourly/monthly rates and unparseable
 * strings stay null: a number that means something different from every other
 * row's number is worse than no number at all, because the salary filters
 * compare them directly.
 */

export interface ParsedSalaryRange {
  min: number | null;
  max: number | null;
  currency: string | null;
}

const NONE: ParsedSalaryRange = { min: null, max: null, currency: null };

/** "$120 - $170 /hour", "$3.5k–$4.9k/mo", "€6k per month" — not annual. */
const NON_ANNUAL_RE = /\/\s*(hour|hr|month|mo|week|wk|day)\b|per\s+(hour|month|week|day)|monthly|hourly/i;

export function parseSalaryString(raw?: string): ParsedSalaryRange {
  if (!raw) return NONE;
  const s = raw.trim();
  if (!s || NON_ANNUAL_RE.test(s)) return NONE;

  const currency = /\$|usd/i.test(s)
    ? 'USD'
    : /€|eur/i.test(s)
      ? 'EUR'
      : /£|gbp/i.test(s)
        ? 'GBP'
        : null;

  const nums: number[] = [];
  const re = /([\d][\d.,]*)\s*(k)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const digits = m[1];
    if (!digits) continue;
    let n = Number.parseFloat(digits.replace(/,/g, ''));
    if (Number.isNaN(n)) continue;
    if (m[2]) n *= 1000;
    else if (n < 1000) continue; // ignore stray small numbers (page counts, etc.)
    nums.push(n);
  }
  if (nums.length === 0) return NONE;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max: max === min ? null : max, currency: currency ?? 'USD' };
}
