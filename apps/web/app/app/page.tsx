import type { ApplicationItem, ApplicationStats } from '@jobradar/shared';

import { FollowUpList } from '@/components/follow-up-list';
import { FunnelStats } from '@/components/funnel-stats';
import { getServerT } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/server-auth';
import { serverApiGet } from '@/lib/server-api';

export default async function DashboardPage() {
  const [reminders, stats, user] = await Promise.all([
    serverApiGet<ApplicationItem[]>('/applications/reminders'),
    serverApiGet<ApplicationStats>('/applications/stats'),
    getCurrentUser(),
  ]);
  const { t } = await getServerT(user?.language);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
        <p className="text-[var(--color-muted-foreground)]">{t('dashboard.subtitle')}</p>
      </div>
      <FunnelStats stats={stats} />
      <FollowUpList items={reminders} now={new Date()} />
    </div>
  );
}
