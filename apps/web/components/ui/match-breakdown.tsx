'use client';

import type { ResumeMatchDimension } from '@jobradar/shared';

import { scoreColor } from '@/components/ui/score-gauge';
import { useI18n } from '@/lib/i18n/context';

/**
 * Per-criterion resume-fit breakdown (ADR-012): a labeled, colored bar and a
 * one-line note per criterion. The overall score (weighted average) is shown
 * separately by the gauge; this explains where it comes from.
 */
export function MatchBreakdown({ dimensions }: { dimensions: ResumeMatchDimension[] }) {
  const { t } = useI18n();
  if (dimensions.length === 0) return null;

  return (
    <ul className="space-y-3">
      {dimensions.map((dim) => {
        const percent = Math.round(Math.min(1, Math.max(0, dim.score)) * 100);
        const color = scoreColor(dim.score);
        return (
          <li key={dim.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{t(`detail.fitDim.${dim.key}`)}</span>
              <span className="font-semibold tabular-nums" style={{ color }}>
                {percent}%
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t(`detail.fitDim.${dim.key}`)}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${percent}%`, backgroundColor: color }}
              />
            </div>
            {dim.note ? (
              <p className="text-xs leading-relaxed text-[var(--color-muted-foreground)]">
                {dim.note}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
