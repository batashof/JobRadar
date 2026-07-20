/** PDF sniffing and extracted-text cleanup, kept pure for testing. */

/** True when the buffer starts with the PDF magic bytes. */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * pdf-parse output tends to carry stray carriage returns, trailing spaces and
 * long blank-line runs; collapse them so LLM prompts don't pay tokens for noise.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
