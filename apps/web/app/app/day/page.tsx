import type { PlanCandidatesResponse, PlannerTodayResponse } from '@jobradar/shared';

import { DayPlanner } from '@/components/day-planner';
import { serverApiGet } from '@/lib/server-api';

/** The day surface (ADR-015). Candidate titles arrive already localised. */
export default async function DayPage() {
  const [today, candidates] = await Promise.all([
    serverApiGet<PlannerTodayResponse>('/planner/today'),
    serverApiGet<PlanCandidatesResponse>('/planner/candidates'),
  ]);
  return <DayPlanner initial={today} initialCandidates={candidates} />;
}
