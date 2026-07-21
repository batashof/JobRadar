import type {
  ApplyEmailDraft,
  ApplyEmailSendInput,
  ApplyEmailSendResult,
  GmailStatus,
} from '@jobradar/shared';

import { apiFetch } from './api';

export function fetchGmailStatus(): Promise<GmailStatus> {
  return apiFetch<GmailStatus>('/gmail/status');
}

/** Returns the Google consent-screen URL to navigate the browser to. */
export function startGmailOauth(): Promise<{ url: string }> {
  return apiFetch<{ url: string }>('/gmail/oauth/start');
}

export function disconnectGmail(): Promise<void> {
  return apiFetch<void>('/gmail/connection', { method: 'DELETE' });
}

export function draftApplyEmail(vacancyId: string, coverLetter: string): Promise<ApplyEmailDraft> {
  return apiFetch<ApplyEmailDraft>(`/vacancies/${vacancyId}/apply-email/draft`, {
    method: 'POST',
    body: JSON.stringify({ coverLetter }),
  });
}

export function sendApplyEmail(
  vacancyId: string,
  input: ApplyEmailSendInput,
): Promise<ApplyEmailSendResult> {
  return apiFetch<ApplyEmailSendResult>(`/vacancies/${vacancyId}/apply-email/send`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
