import type { VacancyDetail } from '@jobradar/shared';
import { notFound } from 'next/navigation';

import { VacancyDetailView } from '@/components/vacancy-detail';
import { isApiStatus, serverApiGet } from '@/lib/server-api';

export default async function VacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail: VacancyDetail;
  try {
    detail = await serverApiGet<VacancyDetail>(`/vacancies/${id}`);
  } catch (error) {
    // Only a real 404 is "no such vacancy". An outage or a 500 used to land
    // here too and render a misleading not-found page; let those bubble to the
    // error boundary, which says what actually happened.
    if (isApiStatus(error, 404)) notFound();
    throw error;
  }
  return <VacancyDetailView detail={detail} />;
}
