'use client';

import {
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type ProfileCreateInput,
  profileCreateSchema,
  type SearchProfile,
  WORK_FORMATS,
  type WorkFormat,
} from '@jobradar/shared';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { EMPLOYMENT_TYPE_LABELS, WORK_FORMAT_LABELS } from '@/lib/labels';

function splitTags(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function toIntOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export interface ProfileFormProps {
  initial?: SearchProfile;
  onSubmit: (input: ProfileCreateInput) => Promise<void>;
  onCancel: () => void;
}

export function ProfileForm({ initial, onSubmit, onCancel }: ProfileFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join(', '));
  const [stack, setStack] = useState((initial?.stack ?? []).join(', '));
  const [workFormat, setWorkFormat] = useState<WorkFormat[]>(initial?.workFormat ?? []);
  const [employmentType, setEmploymentType] = useState<EmploymentType[]>(
    initial?.employmentType ?? [],
  );
  const [salaryMin, setSalaryMin] = useState(initial?.salaryMin?.toString() ?? '');
  const [salaryMax, setSalaryMax] = useState(initial?.salaryMax?.toString() ?? '');
  const [salaryCurrency, setSalaryCurrency] = useState(initial?.salaryCurrency ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = profileCreateSchema.safeParse({
      name,
      keywords: splitTags(keywords),
      stack: splitTags(stack),
      workFormat,
      employmentType,
      salaryMin: toIntOrNull(salaryMin),
      salaryMax: toIntOrNull(salaryMax),
      salaryCurrency: salaryCurrency.trim() ? salaryCurrency.trim() : null,
      isActive,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial ? 'Edit profile' : 'New search profile'}</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="keywords">Keywords</Label>
            <Input
              id="keywords"
              placeholder="react, typescript, node"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
            <p className="text-xs text-[var(--color-muted-foreground)]">Comma-separated.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stack">Stack</Label>
            <Input
              id="stack"
              placeholder="React, PostgreSQL"
              value={stack}
              onChange={(e) => setStack(e.target.value)}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Work format</legend>
            <div className="flex flex-wrap gap-4">
              {WORK_FORMATS.map((wf) => (
                <label key={wf} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={workFormat.includes(wf)}
                    onChange={() => setWorkFormat((prev) => toggle(prev, wf))}
                  />
                  {WORK_FORMAT_LABELS[wf]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Employment type</legend>
            <div className="flex flex-wrap gap-4">
              {EMPLOYMENT_TYPES.map((et) => (
                <label key={et} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={employmentType.includes(et)}
                    onChange={() => setEmploymentType((prev) => toggle(prev, et))}
                  />
                  {EMPLOYMENT_TYPE_LABELS[et]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="salaryMin">Salary min</Label>
              <Input
                id="salaryMin"
                inputMode="numeric"
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salaryMax">Salary max</Label>
              <Input
                id="salaryMax"
                inputMode="numeric"
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salaryCurrency">Currency</Label>
              <Input
                id="salaryCurrency"
                maxLength={3}
                placeholder="USD"
                value={salaryCurrency}
                onChange={(e) => setSalaryCurrency(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active (included in matching &amp; digests)
          </label>

          {error ? (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Create profile'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
