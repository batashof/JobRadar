import type { ApplicationStats } from '@jobradar/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { APPLICATION_STAGE_LABELS } from '@/lib/labels';

function pct(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

/** Applied → offer conversion funnel built from furthest-reached stages. */
export function FunnelStats({ stats }: { stats: ApplicationStats }) {
  const hasApplied = (stats.funnel[0]?.reached ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funnel</CardTitle>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          How far applications get; rejected ones still count up to the stage they reached.
          {stats.total > 0 ? ` ${stats.total} on the board total.` : ''}
        </p>
      </CardHeader>
      <CardContent>
        {!hasApplied ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No sent applications yet — the funnel starts once something moves past Saved.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.funnel.map((step, i) => (
              <div
                key={step.stage}
                className="rounded-md border border-[var(--color-border)] p-3"
                data-testid={`funnel-${step.stage}`}
              >
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {APPLICATION_STAGE_LABELS[step.stage] ?? step.stage}
                </div>
                <div className="text-2xl font-semibold">{step.reached}</div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {i === 0 ? 'sent' : `${pct(step.conversion)} of previous`}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
