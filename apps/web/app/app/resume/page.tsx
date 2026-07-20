import type { ResumeItem } from '@jobradar/shared';

import { ResumeManager } from '@/components/resume-manager';
import { serverApiGet } from '@/lib/server-api';

export default async function ResumePage() {
  const resumes = await serverApiGet<ResumeItem[]>('/resumes');
  return <ResumeManager initial={resumes} />;
}
