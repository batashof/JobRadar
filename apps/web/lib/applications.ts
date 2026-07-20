import type {
  ApplicationItem,
  ApplicationReorderInput,
  ApplicationStage,
  ApplicationUpdateInput,
} from '@jobradar/shared';

import { apiFetch } from './api';

export function listApplications(): Promise<ApplicationItem[]> {
  return apiFetch<ApplicationItem[]>('/applications');
}

/** Applications past their follow-up threshold (oldest activity first). */
export function listReminders(): Promise<ApplicationItem[]> {
  return apiFetch<ApplicationItem[]>('/applications/reminders');
}

export function createApplication(
  vacancyId: string,
  stage?: ApplicationStage,
): Promise<ApplicationItem> {
  return apiFetch<ApplicationItem>('/applications', {
    method: 'POST',
    body: JSON.stringify({ vacancyId, ...(stage ? { stage } : {}) }),
  });
}

export function updateApplication(
  id: string,
  input: ApplicationUpdateInput,
): Promise<ApplicationItem> {
  return apiFetch<ApplicationItem>(`/applications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteApplication(id: string): Promise<void> {
  return apiFetch<void>(`/applications/${id}`, { method: 'DELETE' });
}

export function reorderApplications(input: ApplicationReorderInput): Promise<ApplicationItem[]> {
  return apiFetch<ApplicationItem[]>('/applications/reorder', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
