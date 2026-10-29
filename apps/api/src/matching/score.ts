import {
  type CandidateSkill,
  canonicalSkill,
  detectSeniority,
  type EmploymentType,
  type FeedbackWeights,
  type Language,
  relatedSkills,
  type SeniorityLevel,
  SENIORITY_LEVELS,
  seniorityRank,
  skillLabel,
  skillTextPatterns,
  SKILL_DICTIONARY,
  type WorkFormat,
} from '@jobradar/shared';

import { DESCRIPTION_SCAN_CHARS, ROLE_FAMILIES } from './resume-terms';

/**
 * The deterministic resume ↔ vacancy fit of ADR-025 §5: same input, same
 * output, no tokens. It scores every vacancy for every user who is not the
 * owner (the owner keeps the LLM verdict, ADR-024 §3).
 *
 * Four signals, weighted into 0..100:
 *   - skills (55%): how much of what the posting asks for the candidate has,
 *     and how much of the candidate's core stack the posting uses;
 *   - title (20%): the posting is the candidate's kind of job;
 *   - grade (15%): the posting's level against the candidate's;
 *   - freshness (10%): a week-old posting has had a week of applicants.
 * A posting for another job family or two grades away is capped, whatever the
 * skill overlap says — a backend role full of "TypeScript" is still not a
 * frontend job, and neither is an SEO specialist's (ADR-032).
 */

export const SCORE_WEIGHTS = { skills: 0.55, title: 0.2, grade: 0.15, freshness: 0.1 } as const;

/**
 * Ceiling for a posting of another job family (a backend role or an SEO
 * specialist for a frontend resume). Below the lowest min-fit preset (40), so
 * such a posting never reaches a digest, whatever the floor.
 */
export const WRONG_FAMILY_CAP = 30;
/** Ceiling for a posting two or more grades away from the candidate. */
export const FAR_GRADE_CAP = 40;
/** Feedback can move a score by at most this many points either way (ADR-025 §7). */
export const FEEDBACK_MAX_POINTS = 15;

/** Bounds of the per-key feedback weights. */
export const SKILL_WEIGHT_BOUNDS = { min: -0.5, max: 0.5 } as const;
export const COMPANY_WEIGHT_BOUNDS = { min: -1, max: 0.5 } as const;

/**
 * Title credit kept when the title names a stack and none of it is the
 * candidate's ("Front-End Vue.js" for a React developer): the right job family
 * on the wrong framework is a different job day to day.
 */
export const TITLE_STACK_MISMATCH = 0.5;
/** Credit for a posting skill the candidate has only an adjacent technology for. */
const ADJACENT_CREDIT = 0.5;
/** A posting naming no known technology says nothing either way about skills. */
const NO_SKILLS_COVERAGE = 0.3;
/** Core skills a posting must use to count as "uses the candidate's stack" in full. */
const CORE_HITS_FOR_FULL = 3;
/** How many missing skills a card names. */
const MISSING_SHOWN = 3;

export interface ScoringProfile {
  role: string | null;
  grade: SeniorityLevel | null;
  skills: CandidateSkill[];
}

export interface ScoringVacancy {
  title: string;
  company: string;
  description: string;
  seniority: string | null;
  publishedAt: Date | null;
}

export const EMPTY_FEEDBACK: FeedbackWeights = { skills: {}, companies: {} };

export type GradeFit = 'match' | 'above' | 'below' | 'far' | 'unknown';

export interface VacancyScore {
  /** 0..100. */
  score: number;
  /** Candidate skills the posting asks for, as card labels. */
  matched: string[];
  /** Posting skills the candidate has an adjacent technology for. */
  related: string[];
  /** Posting skills the candidate has nothing for, at most MISSING_SHOWN. */
  missing: string[];
  grade: GradeFit;
  /** The posting's level, when one is known. */
  vacancyLevel: SeniorityLevel | null;
  /** Every known skill key the posting mentions, for feedback updates. */
  vacancySkills: string[];
}

// ---------------------------------------------------------------------------
// Text matching
// ---------------------------------------------------------------------------

const patternCache = new Map<string, RegExp>();

/**
 * Word-boundary, Unicode-aware; same rule as resume-terms and seniority, plus
 * a dot before the phrase breaks it: the "js" of "Vue.js" or "Next.js" is not
 * JavaScript, and reading it as such made a Vue title look like the
 * candidate's stack.
 */
function phrasePattern(phrase: string): RegExp {
  let pattern = patternCache.get(phrase);
  if (!pattern) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`(?<![\\p{L}\\p{N}.])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
    patternCache.set(phrase, pattern);
  }
  return pattern;
}

function mentions(key: string, text: string): boolean {
  return skillTextPatterns(key).some((phrase) => phrasePattern(phrase).test(text));
}

/** Every dictionary skill a posting names, in dictionary order. */
export function detectVacancySkills(title: string, description: string): string[] {
  const text = `${title}\n${description.slice(0, DESCRIPTION_SCAN_CHARS)}`;
  return SKILL_DICTIONARY.filter((entry) => mentions(entry.key, text)).map((entry) => entry.key);
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/**
 * Words a title uses for an engineering family that are too loose for a
 * resume: "QA Automation Engineer" and "Manual Tester" are QA jobs, but a
 * frontend resume says "QA" and "designer" in passing.
 */
const TITLE_ONLY_TERMS: Record<string, string[]> = {
  qa: ['qa', 'aqa', 'tester', 'test automation', 'тестировщик', 'тестирования'],
  design: ['designer', 'дизайнер', 'ux/ui', 'ui/ux'],
  analytics: ['analyst', 'аналитик'],
};

/**
 * Job families as a title names them: ROLE_FAMILIES plus title-only words and
 * the non-engineering jobs that boards and channels also post. A
 * non-engineering title ("Senior SEO Specialist") still lists React and
 * TypeScript when the site it works on is built with them, and before these
 * families existed such a title read as generic and passed on skills alone.
 * Kept out of ROLE_FAMILIES because that list also reads resumes, where
 * "worked with the marketing team" is not a career.
 */
export const TITLE_FAMILIES: { family: string; terms: string[] }[] = [
  ...ROLE_FAMILIES.map((entry) => ({
    family: entry.family,
    terms: [...entry.terms, ...(TITLE_ONLY_TERMS[entry.family] ?? [])],
  })),
  { family: 'seo', terms: ['seo', 'сео'] },
  {
    family: 'marketing',
    terms: ['marketing', 'marketer', 'smm', 'ppc', 'growth manager', 'маркетинг', 'маркетолог', 'таргетолог'],
  },
  {
    family: 'content',
    terms: ['copywriter', 'content manager', 'content writer', 'editor', 'копирайтер', 'контент', 'редактор'],
  },
  {
    family: 'sales',
    terms: ['sales', 'account manager', 'account executive', 'business development', 'менеджер по продажам', 'продажи'],
  },
  { family: 'hr', terms: ['recruiter', 'recruitment', 'talent acquisition', 'sourcer', 'hr', 'рекрутер'] },
  {
    family: 'support',
    terms: ['customer support', 'customer success', 'support specialist', 'call center', 'поддержка', 'поддержки'],
  },
  {
    family: 'management',
    terms: ['project manager', 'delivery manager', 'scrum master', 'руководитель проекта', 'руководитель проектов'],
  },
];

/** Families no engineering resume belongs to. */
export const NON_ENGINEERING_FAMILIES = new Set(['seo', 'marketing', 'content', 'sales', 'hr', 'support', 'management']);

/** Words that make a title an engineering job whatever team it serves. */
const ENGINEERING_WORDS = [
  'developer', 'engineer', 'programmer', 'dev', 'разработчик', 'программист', 'инженер',
  'desenvolvedor', 'développeur', 'entwickler', 'desarrollador', 'programista',
];

/** Job family of a free-text role ("Senior Frontend Developer" → frontend). */
export function roleFamily(role: string | null): string | null {
  if (!role) return null;
  const text = role.toLowerCase();
  // Bare words as well as the families' phrases: a role is short and
  // "Frontend Developer" is written in a dozen ways.
  const found = TITLE_FAMILIES.find((family) =>
    [...family.terms, family.family].some((term) => phrasePattern(term).test(text)),
  );
  return found?.family ?? null;
}

/**
 * Every job family a title names. A non-engineering family counts only when
 * the title has no engineering word: "Software Engineer, Sales Tools" is an
 * engineering job, "Senior SEO Specialist" is not.
 */
export function titleFamilies(title: string): Set<string> {
  const text = title.toLowerCase();
  const engineering = ENGINEERING_WORDS.some((word) => phrasePattern(word).test(text));
  return new Set(
    TITLE_FAMILIES.filter(
      (family) =>
        !(engineering && NON_ENGINEERING_FAMILIES.has(family.family)) &&
        family.terms.some((term) => phrasePattern(term).test(text)),
    ).map((family) => family.family),
  );
}

/** Families a candidate of `family` can take a role of, besides their own. */
const COMPATIBLE: Record<string, string[]> = {
  frontend: ['fullstack'],
  backend: ['fullstack'],
  fullstack: ['frontend', 'backend'],
};

function titleSignal(
  title: string,
  family: string | null,
  coreKeys: string[],
  ownKeys: Set<string>,
): { value: number; wrongFamily: boolean } {
  const families = titleFamilies(title);
  const titleSkills = detectVacancySkills(title, '');
  const stack = titleSkills.length > 0 && !titleSkills.some((key) => ownKeys.has(key)) ? TITLE_STACK_MISMATCH : 1;
  if (family && families.has(family)) return { value: stack, wrongFamily: false };
  if (family && (COMPATIBLE[family] ?? []).some((other) => families.has(other))) {
    return { value: 0.7 * stack, wrongFamily: false };
  }
  // A title naming another job family is a different job, however the
  // description reads.
  if (family && families.size > 0) return { value: 0, wrongFamily: true };
  // An SEO or sales title is off track for a resume of no known family too:
  // a resume that lists technologies is an engineering one.
  if (families.size > 0 && [...families].every((name) => NON_ENGINEERING_FAMILIES.has(name))) {
    return { value: 0, wrongFamily: true };
  }
  // A generic title ("Software Engineer") naming the candidate's stack.
  const text = title.toLowerCase();
  if (coreKeys.some((key) => mentions(key, text))) return { value: 0.7, wrongFamily: false };
  return { value: 0.3, wrongFamily: false };
}

function gradeSignal(
  candidate: SeniorityLevel | null,
  vacancy: Pick<ScoringVacancy, 'seniority' | 'title'>,
): { value: number; fit: GradeFit; level: SeniorityLevel | null } {
  const stored = vacancy.seniority as SeniorityLevel | null;
  const level =
    stored && (SENIORITY_LEVELS as readonly string[]).includes(stored)
      ? stored
      : detectSeniority(vacancy.title);
  if (!candidate || !level) return { value: 0.7, fit: 'unknown', level };
  const gap = seniorityRank(level) - seniorityRank(candidate);
  if (gap === 0) return { value: 1, fit: 'match', level };
  if (gap === 1) return { value: 0.6, fit: 'above', level };
  if (gap === -1) return { value: 0.6, fit: 'below', level };
  return { value: 0.1, fit: 'far', level };
}

/** 1 for two days, then down to 0.4 at a fortnight; unknown dates sit in between. */
function freshnessSignal(publishedAt: Date | null, now: Date): number {
  if (!publishedAt) return 0.7;
  const days = (now.getTime() - publishedAt.getTime()) / 86_400_000;
  if (days <= 2) return 1;
  if (days >= 14) return 0.4;
  return 1 - ((days - 2) / 12) * 0.6;
}

/** Points from feedback weights, bounded to ±FEEDBACK_MAX_POINTS. */
function feedbackPoints(weights: FeedbackWeights, company: string, vacancySkills: string[]): number {
  const companyWeight = weights.companies[companyKey(company)] ?? 0;
  const skillWeights = vacancySkills
    .map((key) => weights.skills[key])
    .filter((value): value is number => typeof value === 'number');
  const skillMean =
    skillWeights.length > 0 ? skillWeights.reduce((a, b) => a + b, 0) / skillWeights.length : 0;
  const points = companyWeight * 10 + skillMean * 10;
  return Math.max(-FEEDBACK_MAX_POINTS, Math.min(FEEDBACK_MAX_POINTS, points));
}

export function companyKey(company: string): string {
  return company.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// The formula
// ---------------------------------------------------------------------------

export function scoreVacancy(
  profile: ScoringProfile,
  vacancy: ScoringVacancy,
  options: { now: Date; weights?: FeedbackWeights },
): VacancyScore {
  const weights = options.weights ?? EMPTY_FEEDBACK;
  const text = `${vacancy.title}\n${vacancy.description.slice(0, DESCRIPTION_SCAN_CHARS)}`;
  const vacancySkills = detectVacancySkills(vacancy.title, vacancy.description);

  // The candidate's skills, by canonical key; a skill listed twice keeps its
  // stronger weight.
  const own = new Map<string, number>();
  for (const skill of profile.skills) {
    const key = canonicalSkill(skill.name);
    const weight = skill.weight === 'core' ? 1 : 0.5;
    own.set(key, Math.max(own.get(key) ?? 0, weight));
  }

  // What the candidate has that the posting uses. Skills outside the
  // dictionary are matched literally, so a niche one still counts.
  const matchedKeys = [...own.keys()].filter((key) => mentions(key, text));
  const matchedSet = new Set(matchedKeys);
  const ownRelated = new Set([...own.keys()].flatMap((key) => relatedSkills(key)));

  const related: string[] = [];
  const missing: string[] = [];
  for (const key of vacancySkills) {
    if (matchedSet.has(key)) continue;
    if (ownRelated.has(key)) related.push(key);
    else missing.push(key);
  }

  // Coverage: of what the posting asks for, how much the candidate has.
  const asked = vacancySkills.length;
  const covered = vacancySkills.filter((key) => matchedSet.has(key)).length;
  const coverage = asked > 0 ? (covered + related.length * ADJACENT_CREDIT) / asked : NO_SKILLS_COVERAGE;

  // Core use: how much of the candidate's main stack the posting relies on.
  const ownWeight = [...own.values()].reduce((a, b) => a + b, 0);
  const hitWeight = matchedKeys.reduce((sum, key) => sum + (own.get(key) ?? 0), 0);
  const coreUse = ownWeight > 0 ? Math.min(1, hitWeight / Math.min(CORE_HITS_FOR_FULL, ownWeight)) : 0;

  const skills = Math.min(1, 0.5 * coverage + 0.5 * coreUse);
  const coreKeys = [...own.entries()].filter(([, w]) => w === 1).map(([key]) => key);
  const title = titleSignal(vacancy.title, roleFamily(profile.role), coreKeys, new Set(own.keys()));
  const grade = gradeSignal(profile.grade, vacancy);
  const freshness = freshnessSignal(vacancy.publishedAt, options.now);

  let score =
    100 *
      (SCORE_WEIGHTS.skills * skills +
        SCORE_WEIGHTS.title * title.value +
        SCORE_WEIGHTS.grade * grade.value +
        SCORE_WEIGHTS.freshness * freshness) +
    feedbackPoints(weights, vacancy.company, vacancySkills);
  if (title.wrongFamily) score = Math.min(score, WRONG_FAMILY_CAP);
  if (grade.fit === 'far') score = Math.min(score, FAR_GRADE_CAP);

  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    matched: matchedKeys.map(skillLabel),
    related: related.map(skillLabel),
    missing: missing.slice(0, MISSING_SHOWN).map(skillLabel),
    grade: grade.fit,
    vacancyLevel: grade.level,
    vacancySkills,
  };
}

// ---------------------------------------------------------------------------
// Explanation (ADR-025 §5: a template, not prose)
// ---------------------------------------------------------------------------

const EXPLAIN = {
  ru: { matched: 'совпало', related: 'близко', missing: 'нет', grade: 'грейд' },
  en: { matched: 'matched', related: 'related', missing: 'missing', grade: 'grade' },
} as const;

const GRADE_MARK: Record<GradeFit, string> = {
  match: '✓',
  above: '↑',
  below: '↓',
  far: '✗',
  unknown: '',
};

/** "matched: React, TypeScript; missing: GraphQL; grade: Senior ✓" */
export function explainScore(result: VacancyScore, lang: Language): string {
  const words = EXPLAIN[lang];
  const parts: string[] = [];
  if (result.matched.length) parts.push(`${words.matched}: ${result.matched.slice(0, 5).join(', ')}`);
  if (result.related.length) parts.push(`${words.related}: ${result.related.slice(0, 3).join(', ')}`);
  if (result.missing.length) parts.push(`${words.missing}: ${result.missing.join(', ')}`);
  if (result.vacancyLevel && result.grade !== 'unknown') {
    const level = result.vacancyLevel[0]!.toUpperCase() + result.vacancyLevel.slice(1);
    parts.push(`${words.grade}: ${level} ${GRADE_MARK[result.grade]}`);
  }
  const line = parts.join('; ');
  return line ? line[0]!.toUpperCase() + line.slice(1) : '';
}

// ---------------------------------------------------------------------------
// Feedback (ADR-025 §7: a fixed rule, no learning)
// ---------------------------------------------------------------------------

export type FeedbackKind = 'up' | 'down' | 'hide';

const STEP = { company: 0.2, skill: 0.1, hide: 0.3 } as const;

function bump(map: Record<string, number>, key: string, delta: number, bounds: { min: number; max: number }) {
  const next = Math.max(bounds.min, Math.min(bounds.max, (map[key] ?? 0) + delta));
  // Round away float dust so stored weights stay readable.
  map[key] = Math.round(next * 100) / 100;
}

/**
 * The weights after one press. 👍 raises the company and every skill the
 * posting names; 👎 lowers the company and the posting's skills that are not
 * the candidate's core (a dislike of an Angular role must not demote the
 * React the candidate actually does); Hide lowers the company only.
 */
export function applyFeedback(
  weights: FeedbackWeights,
  press: { kind: FeedbackKind; company: string; vacancySkills: string[]; coreSkills: string[] },
): FeedbackWeights {
  const next: FeedbackWeights = { skills: { ...weights.skills }, companies: { ...weights.companies } };
  const company = companyKey(press.company);
  const core = new Set(press.coreSkills.map(canonicalSkill));

  if (press.kind === 'up') {
    if (company) bump(next.companies, company, STEP.company, COMPANY_WEIGHT_BOUNDS);
    for (const key of press.vacancySkills) bump(next.skills, key, STEP.skill, SKILL_WEIGHT_BOUNDS);
  } else if (press.kind === 'down') {
    if (company) bump(next.companies, company, -STEP.company, COMPANY_WEIGHT_BOUNDS);
    for (const key of press.vacancySkills) {
      if (!core.has(key)) bump(next.skills, key, -STEP.skill, SKILL_WEIGHT_BOUNDS);
    }
  } else if (company) {
    bump(next.companies, company, -STEP.hide, COMPANY_WEIGHT_BOUNDS);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Preferences (hard filters set in /settings)
// ---------------------------------------------------------------------------

export interface DeliveryPreferences {
  workFormats: WorkFormat[];
  employmentTypes: EmploymentType[];
  /** Monthly, in USD; null = no floor. */
  minSalaryUsd: number | null;
  /** Places a non-remote posting must be in; empty = anywhere (v2.5.0). */
  locations: string[];
}

/**
 * Russian and English spellings of the places users of a Belarus-born bot
 * search in most, so "Минск" finds "Minsk, Belarus" and back. Anything else
 * matches as typed; a user can add both spellings.
 */
const LOCATION_ALIASES: string[][] = [
  ['минск', 'minsk'],
  ['беларусь', 'belarus'],
  ['польша', 'poland', 'polska'],
  ['варшава', 'warsaw', 'warszawa'],
  ['краков', 'krakow', 'kraków'],
  ['вроцлав', 'wroclaw', 'wrocław'],
  ['грузия', 'georgia'],
  ['тбилиси', 'tbilisi'],
  ['литва', 'lithuania'],
  ['вильнюс', 'vilnius'],
  ['латвия', 'latvia'],
  ['рига', 'riga'],
  ['украина', 'ukraine'],
  ['киев', 'kyiv', 'kiev'],
  ['львов', 'lviv'],
  ['казахстан', 'kazakhstan'],
  ['алматы', 'almaty'],
  ['армения', 'armenia'],
  ['ереван', 'yerevan'],
  ['сербия', 'serbia'],
  ['белград', 'belgrade'],
  ['кипр', 'cyprus'],
  ['германия', 'germany', 'deutschland'],
  ['берлин', 'berlin'],
  ['европа', 'europe', 'eu'],
  ['россия', 'russia'],
  ['москва', 'moscow'],
];

/** Every spelling one typed place stands for, lower-cased. */
function locationSpellings(place: string): string[] {
  const key = place.trim().toLowerCase();
  if (!key) return [];
  return LOCATION_ALIASES.find((group) => group.includes(key)) ?? [key];
}

/**
 * Whether a posting's location matches any wanted place. A remote posting
 * needs no particular place, and an unknown location is not evidence against
 * a posting, so both pass; only a stated location naming none of the places
 * is dropped.
 */
export function matchesLocation(
  wanted: string[],
  vacancy: { location: string | null; workFormat: WorkFormat | null },
): boolean {
  if (wanted.length === 0 || vacancy.workFormat === 'remote' || !vacancy.location?.trim()) return true;
  const text = vacancy.location.toLowerCase();
  return wanted.some((place) =>
    locationSpellings(place).some((spelling) => phrasePattern(spelling).test(text)),
  );
}

/**
 * Above this a posted salary is read as annual. Postings rarely say which, and
 * no monthly developer salary is anywhere near it.
 */
export const ANNUAL_SALARY_THRESHOLD = 20_000;

/**
 * Whether a posting survives the user's hard preferences. Unknown passes: a
 * posting that does not state its format or salary is not evidence against it,
 * and most do not. Only USD salaries are compared; converting currencies at a
 * guessed rate would drop postings on a rounding error.
 */
export function passesPreferences(
  prefs: DeliveryPreferences,
  vacancy: {
    workFormat: WorkFormat | null;
    employmentType: EmploymentType | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    location?: string | null;
  },
): boolean {
  if (!matchesLocation(prefs.locations ?? [], { location: vacancy.location ?? null, workFormat: vacancy.workFormat })) {
    return false;
  }
  if (prefs.workFormats.length > 0 && vacancy.workFormat && !prefs.workFormats.includes(vacancy.workFormat)) {
    return false;
  }
  if (
    prefs.employmentTypes.length > 0 &&
    vacancy.employmentType &&
    !prefs.employmentTypes.includes(vacancy.employmentType)
  ) {
    return false;
  }
  if (prefs.minSalaryUsd && vacancy.salaryCurrency?.toUpperCase() === 'USD') {
    const top = vacancy.salaryMax ?? vacancy.salaryMin;
    if (top) {
      const monthly = top > ANNUAL_SALARY_THRESHOLD ? top / 12 : top;
      if (monthly < prefs.minSalaryUsd) return false;
    }
  }
  return true;
}
