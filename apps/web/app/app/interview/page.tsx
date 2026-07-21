import type { InterviewPlanDetail } from '@jobradar/shared';

import { InterviewWorkspace } from '@/components/interview-workspace';
import { serverApiGet } from '@/lib/server-api';

export default async function InterviewPage() {
  const plan = await serverApiGet<InterviewPlanDetail | null>('/interview/plan');
  return <InterviewWorkspace initialPlan={plan} />;
}
