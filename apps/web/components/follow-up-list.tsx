'use client';

import {
  type ApplicationItem,
  daysSinceActivity,
  reminderThresholdDays,
} from '@jobradar/shared';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n/context';

/** Dashboard list of applications waiting for an answer past their threshold. */
export function FollowUpList({ items, now }: { items: ApplicationItem[]; now: Date }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader className="pb-2">
        <h2 className="text-lg font-semibold">{t('followups.title')}</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t('followups.subtitle')}</p>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-4 text-sm text-[var(--color-muted-foreground)]">{t('followups.none')}</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <a
                    href={item.vacancy.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {item.vacancy.title}
                  </a>
                  <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                    {item.vacancy.company} · {t(`stage.${item.stage}`)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="destructive">
                    {t('followups.daysLimit', {
                      days: daysSinceActivity(item, now),
                      limit: reminderThresholdDays(item),
                    })}
                  </Badge>
                  <Link
                    href="/app/board"
                    className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  >
                    {t('followups.openBoard')}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
