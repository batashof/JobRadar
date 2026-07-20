import type { ApplicationItem, MatchFeed, MatchProfileOption } from '@jobradar/shared';

import { MatchesBrowser } from '@/components/matches-browser';
import { serverApiGet } from '@/lib/server-api';

export default async function MatchesPage() {
  const [initial, profiles, applications] = await Promise.all([
    serverApiGet<MatchFeed>('/matches?page=1&pageSize=20'),
    serverApiGet<MatchProfileOption[]>('/matches/profiles'),
    serverApiGet<ApplicationItem[]>('/applications'),
  ]);
  const trackedIds = applications.map((a) => a.vacancy.id);
  return <MatchesBrowser initial={initial} profiles={profiles} trackedIds={trackedIds} />;
}
