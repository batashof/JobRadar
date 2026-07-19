/** Legal-form words stripped during company normalization (dedup key, ADR-004). */
const LEGAL_SUFFIXES = new Set([
  // en
  'llc', 'inc', 'ltd', 'limited', 'gmbh', 'corp', 'corporation', 'co', 'company',
  'sa', 'srl', 'sro', 'oy', 'ab', 'plc', 'bv', 'ug', 'ag', 'kg', 'llp', 'lp',
  // ru
  'ооо', 'оао', 'зао', 'пао', 'нао', 'ао', 'ип', 'чп', 'тоо', 'гк', 'нко',
]);

/**
 * Normalizes a raw company name into the dedup key: lowercase, quotes and
 * punctuation removed, legal suffixes stripped, whitespace collapsed.
 */
export function normalizeCompanyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/["'`«»„“”‘’]/g, ' ')
    .replace(/[.,;:!?()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !LEGAL_SUFFIXES.has(word))
    .join(' ')
    .trim();
}
