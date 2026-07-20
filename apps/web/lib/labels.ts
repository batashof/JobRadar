import type { ApplicationStage, EmploymentType, WorkFormat } from '@jobradar/shared';

export const WORK_FORMAT_LABELS: Record<WorkFormat, string> = {
  remote: 'Remote',
  onsite: 'On-site',
  hybrid: 'Hybrid',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  freelance: 'Freelance',
};

/** Display names for known source slugs; unknown slugs fall back to the slug itself. */
const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  remoteok: 'RemoteOK',
  weworkremotely: 'WeWorkRemotely',
  hh: 'hh.ru',
};

export function sourceLabel(slug: string): string {
  return SOURCE_LABELS[slug] ?? slug;
}

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  saved: 'Saved',
  applied: 'Applied',
  screening: 'Screening',
  tech_interview: 'Tech interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
