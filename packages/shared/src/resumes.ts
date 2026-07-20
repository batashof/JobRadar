/** Uploaded resume PDFs and their extracted text (ADR-011). */

/** Upload size cap — resumes are small; this also protects the free-tier DB. */
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

/** A resume as serialized by the API (no file bytes; timestamps are ISO strings). */
export interface ResumeItem {
  id: string;
  filename: string;
  /** The active resume drives matching, cover letters, and email applications. */
  isActive: boolean;
  uploadedAt: string;
  /** Length of the text extracted from the PDF; 0 = extraction failed. */
  extractedChars: number;
}
