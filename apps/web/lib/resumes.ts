import type { ResumeItem } from '@jobradar/shared';

import { apiFetch, ApiError } from './api';

export function listResumes(): Promise<ResumeItem[]> {
  return apiFetch<ResumeItem[]>('/resumes');
}

/**
 * Multipart upload — bypasses `apiFetch` because the browser must set the
 * multipart boundary in Content-Type itself.
 */
export async function uploadResume(file: File): Promise<ResumeItem> {
  const form = new FormData();
  form.append('file', file, file.name);

  const res = await fetch('/api/resumes', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const body = (await res.json().catch(() => null)) as
    | (ResumeItem & { message?: string })
    | null;
  if (!res.ok) {
    const message =
      (body && typeof body.message === 'string' && body.message) ||
      `Upload failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as ResumeItem;
}

export function activateResume(id: string): Promise<ResumeItem> {
  return apiFetch<ResumeItem>(`/resumes/${id}/activate`, { method: 'POST' });
}

export function deleteResume(id: string): Promise<void> {
  return apiFetch<void>(`/resumes/${id}`, { method: 'DELETE' });
}

/** Same-origin URL for viewing/downloading the PDF. */
export function resumeFileUrl(id: string): string {
  return `/api/resumes/${id}/file`;
}
