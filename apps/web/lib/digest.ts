import type {
  DigestRunResponse,
  DigestSettings,
  UpdateDigestSettingsInput,
} from '@jobradar/shared';

import { apiFetch } from './api';

/** Daily vacancy digest — schedule configuration. */

export function getDigestSettings(): Promise<DigestSettings> {
  return apiFetch<DigestSettings>('/digest/settings');
}

export function updateDigestSettings(input: UpdateDigestSettingsInput): Promise<DigestSettings> {
  return apiFetch<DigestSettings>('/digest/settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Sends the digest right now, ignoring the schedule. */
export function runDigestNow(): Promise<DigestRunResponse> {
  return apiFetch<DigestRunResponse>('/digest/run', { method: 'POST' });
}
