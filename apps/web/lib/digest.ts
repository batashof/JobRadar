import type { DigestSettings, UpdateDigestSettingsInput } from '@jobradar/shared';

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
