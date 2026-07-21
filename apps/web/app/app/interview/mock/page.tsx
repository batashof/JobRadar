import type { InterviewSessionDetail } from '@jobradar/shared';

import { InterviewMock } from '@/components/interview-mock';
import { serverApiGet } from '@/lib/server-api';

export default async function MockInterviewPage() {
  const session = await serverApiGet<InterviewSessionDetail | null>('/interview/sessions/active');
  return <InterviewMock initialSession={session} />;
}
