import type {
  EmploymentType,
  SourceOption,
  VacancyDetail,
  VacancyFeed,
  WorkFormat,
} from '@jobradar/shared';

import { apiFetch } from './api';

export interface FeedFilters {
  q: string;
  workFormat: WorkFormat[];
  employmentType: EmploymentType[];
  sources: string[];
  salaryMin: number | null;
}

export const EMPTY_FILTERS: FeedFilters = {
  q: '',
  workFormat: [],
  employmentType: [],
  sources: [],
  salaryMin: null,
};

export function fetchFeed(filters: FeedFilters, page: number, pageSize = 20): Promise<VacancyFeed> {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.workFormat.length) params.set('workFormat', filters.workFormat.join(','));
  if (filters.employmentType.length) params.set('employmentType', filters.employmentType.join(','));
  if (filters.sources.length) params.set('sources', filters.sources.join(','));
  if (filters.salaryMin != null) params.set('salaryMin', String(filters.salaryMin));
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return apiFetch<VacancyFeed>(`/vacancies?${params.toString()}`);
}

export function fetchSources(): Promise<SourceOption[]> {
  return apiFetch<SourceOption[]>('/vacancies/sources');
}

export function fetchVacancy(id: string): Promise<VacancyDetail> {
  return apiFetch<VacancyDetail>(`/vacancies/${id}`);
}
