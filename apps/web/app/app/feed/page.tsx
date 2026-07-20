import type { ApplicationItem, VacancyFeed } from '@jobradar/shared';

import { FeedBrowser } from '@/components/feed-browser';
import { serverApiGet } from '@/lib/server-api';

export default async function FeedPage() {
  const [initial, applications] = await Promise.all([
    serverApiGet<VacancyFeed>('/vacancies?page=1&pageSize=20'),
    serverApiGet<ApplicationItem[]>('/applications'),
  ]);
  const trackedIds = applications.map((a) => a.vacancy.id);
  return <FeedBrowser initial={initial} trackedIds={trackedIds} />;
}
