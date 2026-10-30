import { type EmploymentType, type FeedbackWeights, type WorkFormat } from '@jobradar/shared';

import { dropTooJunior } from '../digest/select';
import {
  type DeliveryPreferences,
  passesPreferences,
  type ScoringProfile,
  scoreVacancy,
  titleFamilies,
  type VacancyScore,
} from '../matching/score';
import { type VacancyLanguages } from '../matching/work-language';

/**
 * The delivery decision of the digest funnel replayed for one user, with the
 * reason a vacancy was dropped (ADR-035). Same rules in the same order as
 * DigestSendService: the level gate, the hard preferences, the formula, the
 * floor. Pure, so the audit and its tests see exactly what the bot would do.
 */

export interface AuditVacancy {
  id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  sourceSlug: string | null;
  location: string | null;
  seniority: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  workFormat: WorkFormat | null;
  employmentType: EmploymentType | null;
  publishedAt: Date | null;
  languages: VacancyLanguages;
}

/**
 * Why a vacancy did not go out. The first four are the user's own filters in
 * `/filters`; a drop by one of them is the user's choice, not the formula's.
 */
export type DropReason =
  | 'location'
  | 'work-format'
  | 'employment'
  | 'salary'
  | 'language'
  | 'too-junior'
  | 'wrong-family'
  | 'foreign-stack'
  | 'far-grade'
  | 'below-floor';

/** The drop reason of each ceiling the formula applies. */
const CAP_REASON: Record<NonNullable<VacancyScore['cap']>, DropReason> = {
  family: 'wrong-family',
  stack: 'foreign-stack',
  grade: 'far-grade',
};

export const USER_FILTER_REASONS: ReadonlySet<DropReason> = new Set([
  'location',
  'work-format',
  'employment',
  'salary',
]);

export interface Decision {
  vacancy: AuditVacancy;
  score: number;
  delivered: boolean;
  /** null when delivered. */
  reason: DropReason | null;
  /** Job families the title names, as the formula reads it. */
  titleFamilies: string[];
  result: VacancyScore;
}

const NO_PREFS: DeliveryPreferences = {
  workFormats: [],
  employmentTypes: [],
  minSalaryUsd: null,
  locations: [],
  workLanguages: [],
};

/** Each hard preference alone, in the order a reader of the report thinks of them. */
const PREFERENCE_PARTS: [DropReason, (prefs: DeliveryPreferences) => Partial<DeliveryPreferences>][] = [
  ['language', (prefs) => ({ workLanguages: prefs.workLanguages ?? [] })],
  ['location', (prefs) => ({ locations: prefs.locations ?? [] })],
  ['work-format', (prefs) => ({ workFormats: prefs.workFormats })],
  ['employment', (prefs) => ({ employmentTypes: prefs.employmentTypes })],
  ['salary', (prefs) => ({ minSalaryUsd: prefs.minSalaryUsd })],
];

/** Which hard preference drops this vacancy, or null when it passes them all. */
export function preferenceMiss(prefs: DeliveryPreferences, vacancy: AuditVacancy): DropReason | null {
  if (passesPreferences(prefs, vacancy)) return null;
  for (const [reason, part] of PREFERENCE_PARTS) {
    if (!passesPreferences({ ...NO_PREFS, ...part(prefs) }, vacancy)) return reason;
  }
  return null;
}

export function decide(
  input: {
    profile: ScoringProfile;
    weights: FeedbackWeights;
    prefs: DeliveryPreferences;
    minScore: number;
    now: Date;
  },
  vacancies: AuditVacancy[],
): Decision[] {
  return vacancies.map((vacancy) => {
    const result = scoreVacancy(input.profile, vacancy, { now: input.now, weights: input.weights });
    const families = [...titleFamilies(vacancy.title)];
    const reason: DropReason | null =
      dropTooJunior([vacancy], input.profile.grade).length === 0
        ? 'too-junior'
        : (preferenceMiss(input.prefs, vacancy) ??
          (result.score >= input.minScore ? null : result.cap ? CAP_REASON[result.cap] : 'below-floor'));
    return { vacancy, score: result.score, delivered: reason === null, reason, titleFamilies: families, result };
  });
}

/**
 * Which decisions the LLM judges when the day has more than the budget:
 * every delivered vacancy (is what we sent right?), then the dropped ones
 * closest to the floor and the ones the family cap dropped (is what we held
 * back wrong?), then the rest. Drops by the user's own filters are not judged.
 */
export function pickForJudging(decisions: Decision[], budget: number, minScore: number): Decision[] {
  const judgeable = decisions.filter((d) => !d.reason || !USER_FILTER_REASONS.has(d.reason));
  const rank = (d: Decision): number => {
    if (d.delivered) return 0;
    if (d.reason === 'wrong-family' || d.reason === 'language') return 1;
    if (d.score >= minScore - 20) return 2;
    return 3;
  };
  return [...judgeable]
    .sort((a, b) => rank(a) - rank(b) || b.score - a.score || a.vacancy.id.localeCompare(b.vacancy.id))
    .slice(0, budget);
}
