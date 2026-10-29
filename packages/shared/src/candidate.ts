import { z } from 'zod';

import { SENIORITY_LEVELS } from './seniority';

/**
 * Candidate profile: what one resume analysis at registration turns a resume
 * into (ADR-025). It is the input of rule-based matching for every user who is
 * not the owner, so its fields are the criteria the scoring formula reads.
 */

export const ENGLISH_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type EnglishLevel = (typeof ENGLISH_LEVELS)[number];

/** `core` = what the person does daily; `familiar` = has used, not the main stack. */
export const SKILL_WEIGHTS = ['core', 'familiar'] as const;
export type SkillWeight = (typeof SKILL_WEIGHTS)[number];

export interface CandidateSkill {
  name: string;
  weight: SkillWeight;
}

export interface ResumeEvaluation {
  strengths: string[];
  gaps: string[];
  suggestions: string[];
}

/**
 * Per-user feedback weights (ADR-025 §7): lower-case company name or skill key
 * → weight. 👍 / 👎 / Hide move them within fixed bounds; the scoring formula
 * turns them into a bounded score adjustment.
 */
export interface FeedbackWeights {
  skills: Record<string, number>;
  companies: Record<string, number>;
}

/**
 * Where a profile came from: the LLM, the term fallback when every provider
 * failed, or the user's own answers without a resume (`manual`, ADR-034).
 */
export type CandidateProfileSource = 'llm' | 'fallback' | 'manual';

/** At most this many analyses per user per rolling window (ADR-025 §3). Owner is exempt. */
export const RESUME_ANALYSES_PER_WINDOW = 3;
export const RESUME_ANALYSIS_WINDOW_DAYS = 30;

/** Caps that keep a profile renderable in one Telegram message. */
export const CANDIDATE_SKILLS_MAX = 20;
export const EVALUATION_ITEMS_MAX = 4;

const shortText = z.string().trim().min(1).max(200);

/**
 * The JSON contract of the analysis call. Lenient where models drift (unknown
 * grade → null, extra keys ignored, long lists cut), strict where a wrong value
 * would mislead matching (grade and English must be from the closed lists).
 */
export const resumeAnalysisSchema = z.object({
  role: z.string().trim().min(1).max(80),
  grade: z.enum(SENIORITY_LEVELS).nullable().catch(null),
  years: z.number().int().min(0).max(60).nullable().catch(null),
  skills: z
    .array(z.object({ name: z.string().trim().min(1).max(40), weight: z.enum(SKILL_WEIGHTS).catch('familiar') }))
    .min(1)
    .transform((skills) => skills.slice(0, CANDIDATE_SKILLS_MAX)),
  english: z.enum(ENGLISH_LEVELS).nullable().catch(null),
  location: z.string().trim().max(80).nullable().catch(null),
  salaryUsd: z.number().int().min(0).max(1_000_000).nullable().catch(null),
  evaluation: z.object({
    strengths: z.array(shortText).transform((a) => a.slice(0, EVALUATION_ITEMS_MAX)),
    gaps: z.array(shortText).transform((a) => a.slice(0, EVALUATION_ITEMS_MAX)),
    suggestions: z.array(shortText).transform((a) => a.slice(0, EVALUATION_ITEMS_MAX)),
  }),
});

export type ResumeAnalysis = z.infer<typeof resumeAnalysisSchema>;
