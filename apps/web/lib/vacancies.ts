import type {
  BriefResponse,
  CoverLetterResponse,
  EmploymentType,
  ResumeMatchResponse,
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
  /** Hide roles clearly below the active resume's level (ADR-012). */
  resumeFit: boolean;
  /** Show vacancies the user manually hid (off by default). */
  includeHidden: boolean;
}

export const EMPTY_FILTERS: FeedFilters = {
  q: '',
  workFormat: [],
  employmentType: [],
  sources: [],
  salaryMin: null,
  resumeFit: false,
  includeHidden: false,
};

export function fetchFeed(filters: FeedFilters, page: number, pageSize = 20): Promise<VacancyFeed> {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.workFormat.length) params.set('workFormat', filters.workFormat.join(','));
  if (filters.employmentType.length) params.set('employmentType', filters.employmentType.join(','));
  if (filters.sources.length) params.set('sources', filters.sources.join(','));
  if (filters.salaryMin != null) params.set('salaryMin', String(filters.salaryMin));
  if (filters.resumeFit) params.set('resumeFit', 'true');
  if (filters.includeHidden) params.set('includeHidden', 'true');
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return apiFetch<VacancyFeed>(`/vacancies?${params.toString()}`);
}

export function fetchHiddenIds(): Promise<string[]> {
  return apiFetch<string[]>('/vacancies/hidden');
}

export function hideVacancy(id: string): Promise<void> {
  return apiFetch<void>(`/vacancies/${id}/hide`, { method: 'POST' });
}

export function unhideVacancy(id: string): Promise<void> {
  return apiFetch<void>(`/vacancies/${id}/hide`, { method: 'DELETE' });
}

export function fetchSources(): Promise<SourceOption[]> {
  return apiFetch<SourceOption[]>('/vacancies/sources');
}

export function fetchVacancy(id: string): Promise<VacancyDetail> {
  return apiFetch<VacancyDetail>(`/vacancies/${id}`);
}

export function generateBrief(id: string, force = false): Promise<BriefResponse> {
  return apiFetch<BriefResponse>(`/vacancies/${id}/brief${force ? '?force=true' : ''}`, {
    method: 'POST',
  });
}

export function generateCoverLetter(id: string): Promise<CoverLetterResponse> {
  return apiFetch<CoverLetterResponse>(`/vacancies/${id}/cover-letter`, { method: 'POST' });
}

export function matchResume(id: string): Promise<ResumeMatchResponse> {
  return apiFetch<ResumeMatchResponse>(`/vacancies/${id}/resume-match`, { method: 'POST' });
}
