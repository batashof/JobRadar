'use client';

import type { ApplicationStats } from '@jobradar/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n/context';

function pct(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

/** Applied → offer conversion funnel built from furthest-reached stages. */
export function FunnelStats({ stats }: { stats: ApplicationStats }) {
  const { t } = useI18n();
  const hasApplied = (stats.funnel[0]?.reached ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('funnel.title')}</CardTitle>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t('funnel.subtitle')}
          {stats.total > 0 ? t('funnel.total', { count: stats.total }) : ''}
        </p>
      </CardHeader>
      <CardContent>
        {!hasApplied ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t('funnel.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.funnel.map((step, i) => (
              <div
                key={step.stage}
                className="rounded-md border border-[var(--color-border)] p-3"
                data-testid={`funnel-${step.stage}`}
              >
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {t(`stage.${step.stage}`)}
                </div>
                <div className="text-2xl font-semibold">{step.reached}</div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {i === 0 ? t('funnel.sent') : t('funnel.ofPrevious', { pct: pct(step.conversion) })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
