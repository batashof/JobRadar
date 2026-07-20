import type { VacancyFeed } from '@jobradar/shared';

import { FeedBrowser } from '@/components/feed-browser';
import { serverApiGet } from '@/lib/server-api';

export default async function FeedPage() {
  const initial = await serverApiGet<VacancyFeed>('/vacancies?page=1&pageSize=20');
  return <FeedBrowser initial={initial} />;
}
