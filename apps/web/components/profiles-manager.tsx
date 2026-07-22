'use client';

import type { ProfileCreateInput, SearchProfile } from '@jobradar/shared';
import { useState } from 'react';

import { ProfileForm } from '@/components/profile-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n/context';
import type { TFunction } from '@/lib/i18n/dictionaries';
import { createProfile, deleteProfile, updateProfile } from '@/lib/profiles';

type Mode = { kind: 'idle' } | { kind: 'create' } | { kind: 'edit'; id: string };

function salaryText(p: SearchProfile, t: TFunction): string | null {
  if (p.salaryMin == null && p.salaryMax == null) return null;
  const cur = p.salaryCurrency ? ` ${p.salaryCurrency}` : '';
  if (p.salaryMin != null && p.salaryMax != null) return `${p.salaryMin}–${p.salaryMax}${cur}`;
  if (p.salaryMin != null) return t('profiles.salaryFrom', { min: p.salaryMin, cur });
  return t('profiles.salaryTo', { max: p.salaryMax ?? '', cur });
}

export function ProfilesManager({ initial }: { initial: SearchProfile[] }) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SearchProfile[]>(initial);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });

  async function handleCreate(input: ProfileCreateInput) {
    const created = await createProfile(input);
    setProfiles((prev) => [created, ...prev]);
    setMode({ kind: 'idle' });
  }

  async function handleUpdate(id: string, input: ProfileCreateInput) {
    const updated = await updateProfile(id, input);
    setProfiles((prev) => prev.map((p) => (p.id === id ? updated : p)));
    setMode({ kind: 'idle' });
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('profiles.confirmDelete'))) return;
    await deleteProfile(id);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('profiles.title')}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">{t('profiles.subtitle')}</p>
        </div>
        {mode.kind === 'idle' ? (
          <Button onClick={() => setMode({ kind: 'create' })}>{t('profiles.new')}</Button>
        ) : null}
      </div>

      {mode.kind === 'create' ? (
        <ProfileForm onSubmit={handleCreate} onCancel={() => setMode({ kind: 'idle' })} />
      ) : null}

      {profiles.length === 0 && mode.kind !== 'create' ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            {t('profiles.none')}
          </CardContent>
        </Card>
      ) : null}

      <ul className="space-y-4">
        {profiles.map((profile) =>
          mode.kind === 'edit' && mode.id === profile.id ? (
            <li key={profile.id}>
              <ProfileForm
                initial={profile}
                onSubmit={(input) => handleUpdate(profile.id, input)}
                onCancel={() => setMode({ kind: 'idle' })}
              />
            </li>
          ) : (
            <li key={profile.id}>
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <CardTitle>{profile.name}</CardTitle>
                    {profile.isActive ? (
                      <Badge variant="primary">{t('profiles.active')}</Badge>
                    ) : (
                      <Badge variant="muted">{t('profiles.paused')}</Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMode({ kind: 'edit', id: profile.id })}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(profile.id)}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {profile.workFormat.length > 0 || profile.employmentType.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {profile.workFormat.map((wf) => (
                        <Badge key={wf} variant="outline">
                          {t(`workFormat.${wf}`)}
                        </Badge>
                      ))}
                      {profile.employmentType.map((et) => (
                        <Badge key={et} variant="default">
                          {t(`employmentType.${et}`)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {profile.keywords.length > 0 ? (
                    <p className="text-sm">
                      <span className="text-[var(--color-muted-foreground)]">{t('profiles.keywords')}</span>
                      {profile.keywords.join(', ')}
                    </p>
                  ) : null}
                  {profile.stack.length > 0 ? (
                    <p className="text-sm">
                      <span className="text-[var(--color-muted-foreground)]">{t('profiles.stack')}</span>
                      {profile.stack.join(', ')}
                    </p>
                  ) : null}
                  {salaryText(profile, t) ? (
                    <p className="text-sm">
                      <span className="text-[var(--color-muted-foreground)]">{t('profiles.salary')}</span>
                      {salaryText(profile, t)}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
