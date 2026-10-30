import { type ScoringProfile } from '../matching/score';
import { type AuditVacancy, type Decision } from './decide';
import { type Verdict } from './judge';

/** Test helpers for the audit specs. */

export const FRONTEND: ScoringProfile = {
  role: 'Senior Frontend Developer',
  grade: 'senior',
  skills: [
    { name: 'React', weight: 'core' },
    { name: 'TypeScript', weight: 'core' },
    { name: 'Next.js', weight: 'core' },
    { name: 'Redux', weight: 'familiar' },
  ],
};

export function vacancy(id: string, title: string, description = '', extra: Partial<AuditVacancy> = {}): AuditVacancy {
  return {
    id,
    title,
    company: 'Acme',
    description,
    url: `https://example.com/${id}`,
    sourceSlug: 'djinni',
    location: null,
    seniority: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    workFormat: 'remote',
    employmentType: null,
    publishedAt: new Date('2026-10-30T08:00:00Z'),
    languages: { text: ['en'], required: [] },
    ...extra,
  };
}

export function verdict(id: string, extra: Partial<Verdict> = {}): Verdict {
  return {
    id,
    engineering: true,
    family: 'frontend',
    fit: 80,
    language: 'en',
    titleKeyword: null,
    reason: '',
    ...extra,
  };
}

export function judgedPair(decision: Decision, extra: Partial<Verdict> = {}) {
  return { decision, verdict: verdict(decision.vacancy.id, extra) };
}
