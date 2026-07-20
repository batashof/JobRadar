import type { VacancyDetail } from '@jobradar/shared';
import { notFound } from 'next/navigation';

import { VacancyDetailView } from '@/components/vacancy-detail';
import { serverApiGet } from '@/lib/server-api';

export default async function VacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail: VacancyDetail;
  try {
    detail = await serverApiGet<VacancyDetail>(`/vacancies/${id}`);
  } catch {
    notFound();
  }
  return <VacancyDetailView detail={detail} />;
}
