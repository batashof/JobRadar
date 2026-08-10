import type {
  PlanCandidatesResponse,
  PlannerTodayResponse,
  TelegramLinkStatus,
} from '@jobradar/shared';

import { DayPlanner } from '@/components/day-planner';
import { TelegramLink } from '@/components/telegram-link';
import { serverApiGet } from '@/lib/server-api';

/** The day surface (ADR-015). Candidate titles arrive already localised. */
export default async function DayPage() {
  const [today, candidates, telegram] = await Promise.all([
    serverApiGet<PlannerTodayResponse>('/planner/today'),
    serverApiGet<PlanCandidatesResponse>('/planner/candidates'),
    serverApiGet<TelegramLinkStatus>('/bot/telegram'),
  ]);
  return (
    <div className="space-y-6">
      <DayPlanner initial={today} initialCandidates={candidates} />
      <TelegramLink initial={telegram} plannerEnabled={today.settings.telegramEnabled} />
    </div>
  );
}
