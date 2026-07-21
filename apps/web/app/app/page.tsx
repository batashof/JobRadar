import type { ApplicationItem, ApplicationStats } from '@jobradar/shared';

import { FollowUpList } from '@/components/follow-up-list';
import { FunnelStats } from '@/components/funnel-stats';
import { serverApiGet } from '@/lib/server-api';

export default async function DashboardPage() {
  const [reminders, stats] = await Promise.all([
    serverApiGet<ApplicationItem[]>('/applications/reminders'),
    serverApiGet<ApplicationStats>('/applications/stats'),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-[var(--color-muted-foreground)]">
          Browse the feed, check your matches, and keep applications moving on the board.
        </p>
      </div>
      <FunnelStats stats={stats} />
      <FollowUpList items={reminders} now={new Date()} />
    </div>
  );
}
