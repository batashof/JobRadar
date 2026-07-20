import type { ApplicationItem } from '@jobradar/shared';

import { KanbanBoard } from '@/components/kanban-board';
import { serverApiGet } from '@/lib/server-api';

export default async function BoardPage() {
  const applications = await serverApiGet<ApplicationItem[]>('/applications');
  return <KanbanBoard initial={applications} />;
}
