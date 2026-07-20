'use client';

import {
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type VacancyFeed,
  type VacancyListItem,
  WORK_FORMATS,
  type WorkFormat,
} from '@jobradar/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { createApplication } from '@/lib/applications';
import { EMPLOYMENT_TYPE_LABELS, WORK_FORMAT_LABELS } from '@/lib/labels';
import { EMPTY_FILTERS, fetchFeed, type FeedFilters } from '@/lib/vacancies';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function salaryText(v: VacancyListItem): string | null {
  // Some sources emit 0/0 for "no salary" — treat non-positive as absent.
  const min = v.salaryMin && v.salaryMin > 0 ? v.salaryMin : null;
  const max = v.salaryMax && v.salaryMax > 0 ? v.salaryMax : null;
  if (min == null && max == null) return null;
  const cur = v.salaryCurrency ? ` ${v.salaryCurrency}` : '';
  if (min != null && max != null) return `${min}–${max}${cur}`;
  if (min != null) return `from ${min}${cur}`;
  return `up to ${max}${cur}`;
}

function publishedText(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function VacancyCard({
  v,
  tracked,
  saving,
  onSave,
}: {
  v: VacancyListItem;
  tracked: boolean;
  saving: boolean;
  onSave: (id: string) => void;
}) {
  const salary = salaryText(v);
  const published = publishedText(v.publishedAt);
  return (
    <Card>
      <CardHeader className="gap-2 pb-2">
        <div className="flex items-start justify-between gap-4">
          <a
            href={v.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base font-semibold hover:underline"
          >
            {v.title}
          </a>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="muted">{v.source}</Badge>
            {tracked ? (
              <Badge variant="primary">On board ✓</Badge>
            ) : (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => onSave(v.id)}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        </div>
        <div className="text-sm text-[var(--color-muted-foreground)]">
          {v.company}
          {v.location ? ` · ${v.location}` : ''}
          {published ? ` · ${published}` : ''}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {v.workFormat ? <Badge variant="outline">{WORK_FORMAT_LABELS[v.workFormat]}</Badge> : null}
          {v.employmentType ? (
            <Badge variant="default">{EMPLOYMENT_TYPE_LABELS[v.employmentType]}</Badge>
          ) : null}
          {salary ? <Badge variant="primary">{salary}</Badge> : null}
        </div>
      </CardHeader>
      {v.description ? (
        <CardContent className="pt-0">
          <p className="line-clamp-3 text-sm text-[var(--color-muted-foreground)]">
            {v.description}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function FeedBrowser({
  initial,
  trackedIds,
}: {
  initial: VacancyFeed;
  trackedIds: string[];
}) {
  const [tracked, setTracked] = useState<Set<string>>(() => new Set(trackedIds));
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [qInput, setQInput] = useState('');
  const [workFormat, setWorkFormat] = useState<WorkFormat[]>([]);
  const [employmentType, setEmploymentType] = useState<EmploymentType[]>([]);
  const [salaryInput, setSalaryInput] = useState('');

  const [filters, setFilters] = useState<FeedFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [feed, setFeed] = useState<VacancyFeed>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Skip the very first fetch: `initial` already holds the unfiltered page 1.
  // A ref (not state) so flipping it doesn't itself re-trigger the effect.
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFeed(filters, page)
      .then((result) => {
        if (!cancelled) setFeed(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load vacancies');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const salaryMin = salaryInput.trim() ? Math.trunc(Number(salaryInput)) : null;
    setFilters({
      q: qInput,
      workFormat,
      employmentType,
      salaryMin: salaryMin != null && Number.isFinite(salaryMin) ? salaryMin : null,
    });
    setPage(1);
  }

  function handleSave(id: string) {
    setSaving((prev) => new Set(prev).add(id));
    createApplication(id)
      .then(() => setTracked((prev) => new Set(prev).add(id)))
      .catch((err: unknown) => {
        // 409 = already on the board: treat as saved rather than an error.
        if (err instanceof ApiError && err.status === 409) {
          setTracked((prev) => new Set(prev).add(id));
        } else {
          setError('Could not save to the board.');
        }
      })
      .finally(() =>
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      );
  }

  const totalPages = Math.max(1, Math.ceil(feed.total / feed.pageSize));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vacancies</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Aggregated from all active sources. Full-text search, filter, and browse.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={applyFilters} className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Search vacancies"
                placeholder="Search title, company, description…"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  aria-label="Minimum salary"
                  inputMode="numeric"
                  placeholder="Min salary"
                  className="w-32"
                  value={salaryInput}
                  onChange={(e) => setSalaryInput(e.target.value)}
                />
                <Button type="submit">Search</Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <fieldset className="flex flex-wrap items-center gap-3">
                <Label className="text-[var(--color-muted-foreground)]">Format:</Label>
                {WORK_FORMATS.map((wf) => (
                  <label key={wf} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={workFormat.includes(wf)}
                      onChange={() => setWorkFormat((prev) => toggle(prev, wf))}
                    />
                    {WORK_FORMAT_LABELS[wf]}
                  </label>
                ))}
              </fieldset>
              <fieldset className="flex flex-wrap items-center gap-3">
                <Label className="text-[var(--color-muted-foreground)]">Type:</Label>
                {EMPLOYMENT_TYPES.map((et) => (
                  <label key={et} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={employmentType.includes(et)}
                      onChange={() => setEmploymentType((prev) => toggle(prev, et))}
                    />
                    {EMPLOYMENT_TYPE_LABELS[et]}
                  </label>
                ))}
              </fieldset>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-[var(--color-muted-foreground)]">
        <span>
          {feed.total} {feed.total === 1 ? 'vacancy' : 'vacancies'}
          {loading ? ' · loading…' : ''}
        </span>
        <span>
          Page {feed.page} of {totalPages}
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {feed.items.length === 0 && !loading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            No vacancies match these filters.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {feed.items.map((v) => (
            <li key={v.id}>
              <VacancyCard
                v={v}
                tracked={tracked.has(v.id)}
                saving={saving.has(v.id)}
                onSave={handleSave}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          size="sm"
          disabled={feed.page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>
        <span className="text-sm text-[var(--color-muted-foreground)]">
          {feed.page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={feed.page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
