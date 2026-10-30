import {
  CANDIDATE_SKILLS_MAX,
  type CandidateSkill,
  canonicalSkill,
  detectSeniority,
  type Language,
  type ResumeAnalysis,
  resumeAnalysisSchema,
  type SeniorityLevel,
  SKILL_DICTIONARY,
  skillTextPatterns,
} from '@jobradar/shared';

import type { LlmRequest } from '../llm/llm.types';
import { extractResumeTerms, ROLE_FAMILIES } from '../matching/resume-terms';
import { phrasePattern } from '../matching/score';

/**
 * The one LLM call a non-owner ever costs (ADR-025 §1): resume text in, a
 * structured candidate profile and an evaluation of the resume out. Pure — the
 * prompt, the parse and the no-LLM fallback — so all three are unit-tested.
 */

/** Bump when the prompt or the expected JSON changes; stored on every profile. */
export const ANALYSIS_PROMPT_VERSION = 2;

/** Resumes are 1–3 pages; this keeps a pathological PDF inside a free tier's context. */
const RESUME_CHARS_LIMIT = 12_000;

/** Skills taken as `core` in the fallback profile; the rest are `familiar`. */
const FALLBACK_CORE_SKILLS = 6;

export function buildAnalysisPrompt(
  resumeText: string,
  language: Language,
  today: Date = new Date(),
): LlmRequest {
  const text =
    resumeText.length <= RESUME_CHARS_LIMIT ? resumeText : resumeText.slice(0, RESUME_CHARS_LIMIT);
  const lang = language === 'ru' ? 'Russian' : 'English';
  return {
    system: [
      'You read a job seeker\'s resume and return ONE JSON object, nothing else.',
      'Fields:',
      '- "role": the job they are after, short, in English (e.g. "Frontend Developer").',
      '- "grade": one of "intern", "junior", "middle", "senior", "lead", or null if unclear. Judge from responsibilities and years, not only from titles.',
      `- "years": total years of professional experience as an integer, or null. If the resume states it ("8+ years", "более 8 лет"), use that number. Otherwise count from the start of the first professional job to today, ${today.toISOString().slice(0, 10)}; a job "to present" runs until today. Never round down a stated "N+".`,
      '- "skills": technologies, frameworks and tools they actually used, most important first, at most 20. Each is {"name": canonical name such as "React", "TypeScript", "Node.js", "weight": "core" | "familiar"}. "core" = used in the main recent work; "familiar" = mentioned or used briefly. List every language on its own: JavaScript and TypeScript are two skills, never fold one into the other or into a framework. Everything in the resume\'s skills section belongs here.',
      '- "english": CEFR level "A1".."C2" when the resume states or clearly shows it, else null.',
      '- "location": city and/or country they live in, or null.',
      '- "salaryUsd": desired monthly salary in USD if stated, else null.',
      `- "evaluation": {"strengths": [...], "gaps": [...], "suggestions": [...]}, each 2–4 short items in ${lang}, about the resume as a document for remote IT jobs: what works, what is missing or weak, what to add or rewrite. Be specific to this resume, no generic advice.`,
      'Never invent facts that are not in the resume.',
    ].join('\n'),
    user: `Resume:\n"""\n${text}\n"""`,
    maxTokens: 1200,
    temperature: 0.2,
  };
}

/** The model's reply → a validated analysis, or null when it is not usable. */
export function parseAnalysis(reply: string): ResumeAnalysis | null {
  // First `{` … last `}`: tolerates code fences and a sentence around the JSON.
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = resumeAnalysisSchema.safeParse(raw);
  if (!result.success) return null;
  return { ...result.data, skills: dedupeSkills(result.data.skills) };
}

/**
 * Checks the model's profile against the resume text, where a model is known
 * to slip: it computes years from dates against its own idea of "today" (7
 * for a resume that says "8+ years"), and drops a language it reads as implied
 * by another (JavaScript next to TypeScript). The text wins in both cases; the
 * model's evaluation and everything else stay as they are.
 */
export function reconcileAnalysis(analysis: ResumeAnalysis, resumeText: string): ResumeAnalysis {
  const stated = statedYears(resumeText);
  const years =
    stated !== null && (analysis.years === null || stated > analysis.years) ? stated : analysis.years;
  return { ...analysis, years, skills: completeSkills(analysis.skills, resumeText) };
}

/** "8+ years", "over 8 years", "более 8 лет": a number of years next to a years word. */
const STATED_YEARS = /(?<![\p{L}\p{N}.])(\d{1,2})\s*\+?\s*(?:years?|yrs?|лет|года?)(?![\p{L}])/giu;

/** A total of years a resume says outright ("8+ years of experience"), or null. */
export function statedYears(resumeText: string): number | null {
  let max: number | null = null;
  for (const match of resumeText.matchAll(STATED_YEARS)) {
    const n = Number(match[1]);
    // A lone year count above a working life is a date or a typo, not experience.
    if (n >= 1 && n <= 50 && (max === null || n > max)) max = n;
  }
  return max;
}

/** A skill the model left out becomes `core` at this many mentions in the resume. */
export const MISSED_SKILL_CORE_MENTIONS = 3;

/** How often the resume names a dictionary skill, by any of its spellings. */
function skillMentions(key: string, text: string): number {
  return skillTextPatterns(key).reduce((sum, phrase) => {
    const global = new RegExp(phrasePattern(phrase).source, 'giu');
    return sum + (text.match(global)?.length ?? 0);
  }, 0);
}

/**
 * The model's skills plus the dictionary skills the resume names that the model
 * left out: `core` when named often, else `familiar`. Added core skills go
 * after the model's core ones, so with a full list they push out the model's
 * least important `familiar` ones, never its core ones.
 */
export function completeSkills(skills: CandidateSkill[], resumeText: string): CandidateSkill[] {
  const listed = new Set(skills.map((s) => canonicalSkill(s.name)));
  const missed = SKILL_DICTIONARY.filter((entry) => !listed.has(entry.key))
    .map((entry) => ({ entry, count: skillMentions(entry.key, resumeText) }))
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ entry, count }) => ({
      name: entry.label,
      weight: count >= MISSED_SKILL_CORE_MENTIONS ? ('core' as const) : ('familiar' as const),
    }));
  if (missed.length === 0) return skills;
  const byWeight = (list: CandidateSkill[], weight: CandidateSkill['weight']) =>
    list.filter((s) => s.weight === weight);
  return [
    ...byWeight(skills, 'core'),
    ...byWeight(missed, 'core'),
    ...byWeight(skills, 'familiar'),
    ...byWeight(missed, 'familiar'),
  ].slice(0, CANDIDATE_SKILLS_MAX);
}

/** Case-insensitive dedupe that keeps the first (more important) occurrence. */
export function dedupeSkills(skills: CandidateSkill[]): CandidateSkill[] {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface FallbackProfile {
  role: string | null;
  grade: SeniorityLevel | null;
  skills: CandidateSkill[];
}

/**
 * What registration falls back to when every provider failed (ADR-025 §3):
 * the job family and stack the resume names (ADR-017) and the highest grade it
 * claims. Weaker than an analysis, but enough to start matching, and the user
 * corrects it in the same confirmation dialog.
 */
export function fallbackProfile(resumeText: string): FallbackProfile {
  const terms = extractResumeTerms(resumeText);
  const family = ROLE_FAMILIES.find((f) => f.terms.some((t) => terms.roles.includes(t)));
  const skills = terms.stack.slice(0, CANDIDATE_SKILLS_MAX).map((name, index) => ({
    name: displaySkill(name),
    weight: index < FALLBACK_CORE_SKILLS ? ('core' as const) : ('familiar' as const),
  }));
  return {
    role: family ? ROLE_TITLES[family.family] ?? null : null,
    grade: detectSeniority(resumeText),
    skills,
  };
}

/** Human titles for the job families of `resume-terms.ts`. */
export const ROLE_TITLES: Record<string, string> = {
  frontend: 'Frontend Developer',
  fullstack: 'Fullstack Developer',
  backend: 'Backend Developer',
  mobile: 'Mobile Developer',
  devops: 'DevOps Engineer',
  qa: 'QA Engineer',
  data: 'Data Engineer',
  design: 'Product Designer',
  product: 'Product Manager',
  analytics: 'Business Analyst',
};

/** The dictionary's lower-case terms, written the way people write them. */
const SKILL_DISPLAY: Record<string, string> = {
  react: 'React',
  'react native': 'React Native',
  'next.js': 'Next.js',
  vue: 'Vue',
  nuxt: 'Nuxt',
  angular: 'Angular',
  svelte: 'Svelte',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  redux: 'Redux',
  mobx: 'MobX',
  rxjs: 'RxJS',
  graphql: 'GraphQL',
  html: 'HTML',
  css: 'CSS',
  sass: 'Sass',
  scss: 'SCSS',
  'node.js': 'Node.js',
  nestjs: 'NestJS',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  aws: 'AWS',
  'c#': 'C#',
  '.net': '.NET',
  php: 'PHP',
  sql: 'SQL',
};

export function displaySkill(term: string): string {
  return SKILL_DISPLAY[term] ?? term.charAt(0).toUpperCase() + term.slice(1);
}
