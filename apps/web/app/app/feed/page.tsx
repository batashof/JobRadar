import type { ApplicationItem, ResumeItem, SourceOption, VacancyFeed } from '@jobradar/shared';

import { FeedBrowser } from '@/components/feed-browser';
import { serverApiGet } from '@/lib/server-api';

export default async function FeedPage() {
  const [initial, applications, sourceOptions, resumes, hiddenIds] = await Promise.all([
    serverApiGet<VacancyFeed>('/vacancies?page=1&pageSize=20'),
    serverApiGet<ApplicationItem[]>('/applications'),
    serverApiGet<SourceOption[]>('/vacancies/sources'),
    serverApiGet<ResumeItem[]>('/resumes'),
    serverApiGet<string[]>('/vacancies/hidden'),
  ]);
  const trackedIds = applications.map((a) => a.vacancy.id);
  const hasResume = resumes.some((r) => r.isActive);
  return (
    <FeedBrowser
      initial={initial}
      trackedIds={trackedIds}
      hiddenIds={hiddenIds}
      sourceOptions={sourceOptions}
      hasResume={hasResume}
    />
  );
}
