'use client';

import type { ProfileCreateInput, SearchProfile } from '@jobradar/shared';
import { useState } from 'react';

import { ProfileForm } from '@/components/profile-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createProfile, deleteProfile, updateProfile } from '@/lib/profiles';
import { EMPLOYMENT_TYPE_LABELS, WORK_FORMAT_LABELS } from '@/lib/labels';

type Mode = { kind: 'idle' } | { kind: 'create' } | { kind: 'edit'; id: string };

function salaryText(p: SearchProfile): string | null {
  if (p.salaryMin == null && p.salaryMax == null) return null;
  const cur = p.salaryCurrency ? ` ${p.salaryCurrency}` : '';
  if (p.salaryMin != null && p.salaryMax != null) return `${p.salaryMin}–${p.salaryMax}${cur}`;
  if (p.salaryMin != null) return `from ${p.salaryMin}${cur}`;
  return `up to ${p.salaryMax}${cur}`;
}

export function ProfilesManager({ initial }: { initial: SearchProfile[] }) {
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
    if (!window.confirm('Delete this search profile?')) return;
    await deleteProfile(id);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Search profiles</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            What the radar watches for. Active profiles drive matching and digests.
          </p>
        </div>
        {mode.kind === 'idle' ? (
          <Button onClick={() => setMode({ kind: 'create' })}>New profile</Button>
        ) : null}
      </div>

      {mode.kind === 'create' ? (
        <ProfileForm onSubmit={handleCreate} onCancel={() => setMode({ kind: 'idle' })} />
      ) : null}

      {profiles.length === 0 && mode.kind !== 'create' ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            No search profiles yet. Create one to start matching vacancies.
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
                      <Badge variant="primary">Active</Badge>
                    ) : (
                      <Badge variant="muted">Paused</Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMode({ kind: 'edit', id: profile.id })}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(profile.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {profile.workFormat.length > 0 || profile.employmentType.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {profile.workFormat.map((wf) => (
                        <Badge key={wf} variant="outline">
                          {WORK_FORMAT_LABELS[wf]}
                        </Badge>
                      ))}
                      {profile.employmentType.map((et) => (
                        <Badge key={et} variant="default">
                          {EMPLOYMENT_TYPE_LABELS[et]}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {profile.keywords.length > 0 ? (
                    <p className="text-sm">
                      <span className="text-[var(--color-muted-foreground)]">Keywords: </span>
                      {profile.keywords.join(', ')}
                    </p>
                  ) : null}
                  {profile.stack.length > 0 ? (
                    <p className="text-sm">
                      <span className="text-[var(--color-muted-foreground)]">Stack: </span>
                      {profile.stack.join(', ')}
                    </p>
                  ) : null}
                  {salaryText(profile) ? (
                    <p className="text-sm">
                      <span className="text-[var(--color-muted-foreground)]">Salary: </span>
                      {salaryText(profile)}
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
