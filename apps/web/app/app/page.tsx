import type { ApplicationItem } from '@jobradar/shared';

import { FollowUpList } from '@/components/follow-up-list';
import { serverApiGet } from '@/lib/server-api';

export default async function DashboardPage() {
  const reminders = await serverApiGet<ApplicationItem[]>('/applications/reminders');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-[var(--color-muted-foreground)]">
          Browse the feed, check your matches, and keep applications moving on the board.
        </p>
      </div>
      <FollowUpList items={reminders} now={new Date()} />
    </div>
  );
}
