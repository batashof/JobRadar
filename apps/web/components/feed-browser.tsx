'use client';

import {
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type SourceOption,
  type VacancyFeed,
  WORK_FORMATS,
  type WorkFormat,
} from '@jobradar/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VacancyCard } from '@/components/vacancy-card';
import { ApiError } from '@/lib/api';
import { createApplication } from '@/lib/applications';
import { useI18n } from '@/lib/i18n/context';
import { sourceLabel } from '@/lib/labels';
import { EMPTY_FILTERS, fetchFeed, type FeedFilters } from '@/lib/vacancies';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FeedBrowser({
  initial,
  trackedIds,
  sourceOptions,
  hasResume,
}: {
  initial: VacancyFeed;
  trackedIds: string[];
  sourceOptions: SourceOption[];
  hasResume: boolean;
}) {
  const { t } = useI18n();
  const [tracked, setTracked] = useState<Set<string>>(() => new Set(trackedIds));
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [qInput, setQInput] = useState('');
  const [workFormat, setWorkFormat] = useState<WorkFormat[]>([]);
  const [employmentType, setEmploymentType] = useState<EmploymentType[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
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
          setError(err instanceof ApiError ? err.message : t('feed.loadFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, page, t]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const salaryMin = salaryInput.trim() ? Math.trunc(Number(salaryInput)) : null;
    setFilters((prev) => ({
      q: qInput,
      workFormat,
      employmentType,
      sources: selectedSources,
      salaryMin: salaryMin != null && Number.isFinite(salaryMin) ? salaryMin : null,
      // The resume toggle applies on its own; keep its current state on submit.
      resumeFit: prev.resumeFit,
    }));
    setPage(1);
  }

  function toggleResumeFit(next: boolean) {
    setFilters((prev) => ({ ...prev, resumeFit: next }));
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
          setError(t('feed.saveFailed'));
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
        <h1 className="text-2xl font-semibold">{t('feed.title')}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t('feed.subtitle')}</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={applyFilters} className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label={t('feed.searchAria')}
                placeholder={t('feed.searchPlaceholder')}
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  aria-label={t('feed.minSalaryAria')}
                  inputMode="numeric"
                  placeholder={t('feed.minSalaryPlaceholder')}
                  className="w-32"
                  value={salaryInput}
                  onChange={(e) => setSalaryInput(e.target.value)}
                />
                <Button type="submit">{t('feed.search')}</Button>
              </div>
            </div>
            {hasResume ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.resumeFit}
                  onChange={(e) => toggleResumeFit(e.target.checked)}
                />
                {t('feed.hideBelow')}
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {t('feed.hideBelowHint')}
                </span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <fieldset className="flex flex-wrap items-center gap-3">
                <Label className="text-[var(--color-muted-foreground)]">{t('feed.format')}</Label>
                {WORK_FORMATS.map((wf) => (
                  <label key={wf} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={workFormat.includes(wf)}
                      onChange={() => setWorkFormat((prev) => toggle(prev, wf))}
                    />
                    {t(`workFormat.${wf}`)}
                  </label>
                ))}
              </fieldset>
              <fieldset className="flex flex-wrap items-center gap-3">
                <Label className="text-[var(--color-muted-foreground)]">{t('feed.type')}</Label>
                {EMPLOYMENT_TYPES.map((et) => (
                  <label key={et} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={employmentType.includes(et)}
                      onChange={() => setEmploymentType((prev) => toggle(prev, et))}
                    />
                    {t(`employmentType.${et}`)}
                  </label>
                ))}
              </fieldset>
              {sourceOptions.length > 0 ? (
                <fieldset className="flex flex-wrap items-center gap-3">
                  <Label className="text-[var(--color-muted-foreground)]">{t('feed.source')}</Label>
                  {sourceOptions.map((s) => (
                    <label key={s.slug} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(s.slug)}
                        onChange={() => setSelectedSources((prev) => toggle(prev, s.slug))}
                      />
                      {sourceLabel(s.slug)}
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        ({s.count})
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-[var(--color-muted-foreground)]">
        <span>
          {t(feed.total === 1 ? 'feed.countOne' : 'feed.countMany', { count: feed.total })}
          {loading ? t('feed.loadingSuffix') : ''}
        </span>
        <span>{t('feed.pageOf', { page: feed.page, total: totalPages })}</span>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {feed.items.length === 0 && !loading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            {t('feed.noMatch')}
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
          {t('common.previous')}
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
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}
