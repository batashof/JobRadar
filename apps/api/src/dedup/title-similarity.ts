/** Trigram (Dice coefficient) similarity for fuzzy title matching (ADR-004). */

const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const trigramsOf = (value: string): Set<string> => {
  const padded = `  ${value} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
};

/** Returns similarity in [0, 1]; 1 = identical after normalization. */
export function titleSimilarity(a: string, b: string): number {
  const normA = normalizeTitle(a);
  const normB = normalizeTitle(b);
  if (normA.length === 0 || normB.length === 0) return 0;
  if (normA === normB) return 1;

  const gramsA = trigramsOf(normA);
  const gramsB = trigramsOf(normB);
  let shared = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) shared++;
  return (2 * shared) / (gramsA.size + gramsB.size);
}
