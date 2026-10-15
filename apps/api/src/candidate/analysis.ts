import {
  CANDIDATE_SKILLS_MAX,
  type CandidateSkill,
  detectSeniority,
  type Language,
  type ResumeAnalysis,
  resumeAnalysisSchema,
  type SeniorityLevel,
} from '@jobradar/shared';

import type { LlmRequest } from '../llm/llm.types';
import { extractResumeTerms, ROLE_FAMILIES } from '../matching/resume-terms';

/**
 * The one LLM call a non-owner ever costs (ADR-025 §1): resume text in, a
 * structured candidate profile and an evaluation of the resume out. Pure — the
 * prompt, the parse and the no-LLM fallback — so all three are unit-tested.
 */

/** Bump when the prompt or the expected JSON changes; stored on every profile. */
export const ANALYSIS_PROMPT_VERSION = 1;

/** Resumes are 1–3 pages; this keeps a pathological PDF inside a free tier's context. */
const RESUME_CHARS_LIMIT = 12_000;

/** Skills taken as `core` in the fallback profile; the rest are `familiar`. */
const FALLBACK_CORE_SKILLS = 6;

export function buildAnalysisPrompt(resumeText: string, language: Language): LlmRequest {
  const text =
    resumeText.length <= RESUME_CHARS_LIMIT ? resumeText : resumeText.slice(0, RESUME_CHARS_LIMIT);
  const lang = language === 'ru' ? 'Russian' : 'English';
  return {
    system: [
      'You read a job seeker\'s resume and return ONE JSON object, nothing else.',
      'Fields:',
      '- "role": the job they are after, short, in English (e.g. "Frontend Developer").',
      '- "grade": one of "intern", "junior", "middle", "senior", "lead", or null if unclear. Judge from responsibilities and years, not only from titles.',
      '- "years": total years of professional experience as an integer, or null.',
      '- "skills": technologies, frameworks and tools they actually used, most important first, at most 20. Each is {"name": canonical name such as "React", "TypeScript", "Node.js", "weight": "core" | "familiar"}. "core" = used in the main recent work; "familiar" = mentioned or used briefly.',
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
