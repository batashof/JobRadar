import { z } from 'zod';

/** Email apply via Gmail (ADR-011). */

/** GET /gmail/status */
export interface GmailStatus {
  /** GOOGLE_CLIENT_ID/SECRET are set server-side (feature available at all). */
  configured: boolean;
  /** The user has connected their Gmail account (refresh token stored). */
  connected: boolean;
}

/** POST /vacancies/:id/apply-email/draft — input. */
export const applyEmailDraftSchema = z.object({
  coverLetter: z.string().trim().min(20, 'Generate or write a cover letter first').max(5000),
});
export type ApplyEmailDraftInput = z.infer<typeof applyEmailDraftSchema>;

/** POST /vacancies/:id/apply-email/draft — result (all fields user-editable). */
export interface ApplyEmailDraft {
  /** Pre-filled from the extracted apply contact when it is an email; may be empty. */
  recipient: string;
  subject: string;
  body: string;
}

/** POST /vacancies/:id/apply-email/send — input (what the user confirmed). */
export const applyEmailSendSchema = z.object({
  recipient: z.string().trim().email('Enter a valid recipient email'),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(10).max(10000),
});
export type ApplyEmailSendInput = z.infer<typeof applyEmailSendSchema>;

/** POST /vacancies/:id/apply-email/send — result. */
export interface ApplyEmailSendResult {
  outreachId: string;
  gmailMessageId: string | null;
  sentAt: string;
}
