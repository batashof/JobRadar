'use client';

import type { VacancyListItem } from '@jobradar/shared';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { EMPLOYMENT_TYPE_LABELS, sourceLabel, WORK_FORMAT_LABELS } from '@/lib/labels';

export function salaryText(v: VacancyListItem): string | null {
  // Some sources emit 0/0 for "no salary" — treat non-positive as absent.
  const min = v.salaryMin && v.salaryMin > 0 ? v.salaryMin : null;
  const max = v.salaryMax && v.salaryMax > 0 ? v.salaryMax : null;
  if (min == null && max == null) return null;
  const cur = v.salaryCurrency ? ` ${v.salaryCurrency}` : '';
  if (min != null && max != null) return `${min}–${max}${cur}`;
  if (min != null) return `from ${min}${cur}`;
  return `up to ${max}${cur}`;
}

export function publishedText(iso: string | null): string | null {
  if (!iso) return null;
  // Fixed locale: SSR and the browser must format identically (hydration).
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function VacancyCard({
  v,
  tracked,
  saving,
  onSave,
  leadingBadge,
}: {
  v: VacancyListItem;
  tracked: boolean;
  saving: boolean;
  onSave: (id: string) => void;
  /** Extra badge shown before the source badge (e.g. the match score). */
  leadingBadge?: ReactNode;
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
            {leadingBadge}
            <Badge variant="muted">{sourceLabel(v.source)}</Badge>
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
