import type { EmploymentType, WorkFormat } from '@jobradar/shared';

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
