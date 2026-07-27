'use client';

import type { Language, VacancyListItem } from '@jobradar/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { scoreColor } from '@/components/ui/score-gauge';
import { useI18n } from '@/lib/i18n/context';
import type { TFunction } from '@/lib/i18n/dictionaries';
import { sourceLabel } from '@/lib/labels';

export function salaryText(v: VacancyListItem, t: TFunction): string | null {
  // Some sources emit 0/0 for "no salary" — treat non-positive as absent.
  const min = v.salaryMin && v.salaryMin > 0 ? v.salaryMin : null;
  const max = v.salaryMax && v.salaryMax > 0 ? v.salaryMax : null;
  if (min == null && max == null) return null;
  const cur = v.salaryCurrency ? ` ${v.salaryCurrency}` : '';
  if (min != null && max != null) return `${min}–${max}${cur}`;
  if (min != null) return t('vacancy.salaryFrom', { min, cur });
  return t('vacancy.salaryTo', { max: max ?? '', cur });
}

export function publishedText(iso: string | null, lang: Language): string | null {
  if (!iso) return null;
  // Locale is fixed per render by the account language, so SSR and the browser
  // format identically (no hydration mismatch).
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  return new Date(iso).toLocaleDateString(locale, {
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
  hidden,
  hiding,
  onHide,
  onUnhide,
  leadingBadge,
}: {
  v: VacancyListItem;
  tracked: boolean;
  saving: boolean;
  onSave: (id: string) => void;
  hidden: boolean;
  hiding: boolean;
  onHide: (id: string) => void;
  onUnhide: (id: string) => void;
  /** Extra badge shown before the source badge (e.g. the match score). */
  leadingBadge?: ReactNode;
}) {
  const { t, lang } = useI18n();
  const salary = salaryText(v, t);
  const published = publishedText(v.publishedAt, lang);
  return (
    <Card>
      <CardHeader className="gap-2 pb-2">
        <div className="flex items-start justify-between gap-4">
          {/* The title opens the in-app detail page (ADR-011); the original stays
              reachable from there via "Open original". */}
          <Link href={`/app/vacancies/${v.id}`} className="text-base font-semibold hover:underline">
            {v.title}
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {leadingBadge}
            {v.resumeScore != null ? (
              <span
                className="rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums"
                style={{ color: scoreColor(v.resumeScore), borderColor: scoreColor(v.resumeScore) }}
                title={t('vacancy.resumeFit')}
              >
                CV {Math.round(v.resumeScore * 100)}%
              </span>
            ) : null}
            <Badge variant="muted">{sourceLabel(v.source)}</Badge>
            {tracked ? (
              <Badge variant="primary">{t('vacancy.onBoard')}</Badge>
            ) : (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => onSave(v.id)}>
                {saving ? t('vacancy.saving') : t('vacancy.save')}
              </Button>
            )}
            {hidden ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={hiding}
                onClick={() => onUnhide(v.id)}
                title={t('vacancy.unhideHint')}
              >
                {t('vacancy.unhide')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={hiding}
                onClick={() => onHide(v.id)}
                title={t('vacancy.hideHint')}
              >
                {hiding ? t('vacancy.hiding') : t('vacancy.hide')}
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
          {v.workFormat ? <Badge variant="outline">{t(`workFormat.${v.workFormat}`)}</Badge> : null}
          {v.employmentType ? (
            <Badge variant="default">{t(`employmentType.${v.employmentType}`)}</Badge>
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
