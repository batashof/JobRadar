import { z } from 'zod';

/**
 * Interview-prep module (ADR-013): resume-driven plan, generated Q&A, and
 * LLM-reviewed live-coding. Standalone — anchored to the active resume plus an
 * optional target role/seniority/focus, not to a specific vacancy. All content
 * is LLM-generated on-demand and cached (ADR-005 token discipline).
 */

export const INTERVIEW_SENIORITIES = ['intern', 'junior', 'middle', 'senior', 'lead'] as const;
export type InterviewSeniority = (typeof INTERVIEW_SENIORITIES)[number];

export const INTERVIEW_QUESTION_KINDS = ['theory', 'behavioral', 'coding'] as const;
export type InterviewQuestionKind = (typeof INTERVIEW_QUESTION_KINDS)[number];

export const INTERVIEW_TOPIC_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type InterviewTopicStatus = (typeof INTERVIEW_TOPIC_STATUSES)[number];

export const INTERVIEW_DIFFICULTIES = ['junior', 'middle', 'senior'] as const;
export type InterviewDifficulty = (typeof INTERVIEW_DIFFICULTIES)[number];

// ---------------------------------------------------------------------------
// Plan structure (LLM-generated, stored once in interview_plans.structure)
// ---------------------------------------------------------------------------

export interface InterviewPlanTopic {
  /** Stable slug, unique within a plan; referenced by progress and questions. */
  key: string;
  title: string;
  /** One short line on why this topic matters for the target role. */
  why: string;
}

export interface InterviewPlanSection {
  title: string;
  topics: InterviewPlanTopic[];
}

export interface InterviewPlanStructure {
  sections: InterviewPlanSection[];
}

export interface InterviewTopicProgressItem {
  topicKey: string;
  status: InterviewTopicStatus;
  confidence: number | null;
  updatedAt: string;
}

export interface InterviewPlanSummary {
  id: string;
  targetRole: string | null;
  targetSeniority: InterviewSeniority | null;
  focus: string[];
  createdAt: string;
}

export interface InterviewPlanDetail extends InterviewPlanSummary {
  structure: InterviewPlanStructure;
  progress: InterviewTopicProgressItem[];
}

/** POST /interview/plan — build a plan from the active resume. */
export const generatePlanSchema = z.object({
  targetRole: z.string().trim().max(120).optional(),
  targetSeniority: z.enum(INTERVIEW_SENIORITIES).optional(),
  focus: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});
export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;

/** PATCH /interview/plan/:id/progress — mark a topic's progress. */
export const updateTopicProgressSchema = z.object({
  topicKey: z.string().trim().min(1).max(200),
  status: z.enum(INTERVIEW_TOPIC_STATUSES),
  confidence: z.number().int().min(1).max(5).nullable().optional(),
});
export type UpdateTopicProgressInput = z.infer<typeof updateTopicProgressSchema>;

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export interface InterviewQuestionItem {
  id: string;
  planId: string | null;
  topic: string;
  kind: InterviewQuestionKind;
  difficulty: InterviewDifficulty | null;
  /** The question, or — for `coding` — the live-coding task statement. */
  prompt: string;
  /** True once a model answer has been generated (revealed on demand). */
  hasModelAnswer: boolean;
  /** The model answer, present only after it has been revealed. */
  modelAnswer: string | null;
  createdAt: string;
}

/** POST /interview/questions — generate questions for a topic. */
export const generateQuestionsSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  kind: z.enum(INTERVIEW_QUESTION_KINDS),
  difficulty: z.enum(INTERVIEW_DIFFICULTIES).optional(),
  planId: z.string().uuid().optional(),
  count: z.number().int().min(1).max(5).optional(),
});
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;

// ---------------------------------------------------------------------------
// Answer review (live-coding and written answers)
// ---------------------------------------------------------------------------

/** Structured LLM feedback on a submitted answer/solution. */
export interface InterviewReview {
  /** One-line overall verdict. */
  verdict: string;
  correctness: string;
  complexity: string;
  style: string;
  suggestions: string[];
}

export interface InterviewAnswerReview {
  answerId: string;
  /** 0..1. */
  score: number;
  review: InterviewReview;
}

/** POST /interview/questions/:id/review — submit an answer/solution for review. */
export const reviewAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(20000),
});
export type ReviewAnswerInput = z.infer<typeof reviewAnswerSchema>;

/** POST /interview/questions/:id/model-answer — reveal (and cache) the answer. */
export interface InterviewModelAnswerResponse {
  modelAnswer: string;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Mock interview (text chat) — interview_sessions
// ---------------------------------------------------------------------------

export const INTERVIEW_SESSION_STATUSES = ['in_progress', 'completed', 'abandoned'] as const;
export type InterviewSessionStatus = (typeof INTERVIEW_SESSION_STATUSES)[number];

export type InterviewTurnRole = 'interviewer' | 'candidate';

export interface InterviewTurn {
  role: InterviewTurnRole;
  content: string;
  at: string;
}

/** Final written feedback produced when the session ends. */
export interface InterviewFeedback {
  summary: string;
  strengths: string[];
  gaps: string[];
  /** One line on readiness, e.g. what to work on before the real interview. */
  recommendation: string;
  /** Overall performance, 0..1. */
  score: number;
}

export interface InterviewSessionDetail {
  id: string;
  targetRole: string | null;
  targetSeniority: InterviewSeniority | null;
  status: InterviewSessionStatus;
  transcript: InterviewTurn[];
  feedback: InterviewFeedback | null;
  startedAt: string;
  endedAt: string | null;
}

/** POST /interview/sessions — start a mock interview (interviewer opens). */
export const startSessionSchema = z.object({
  targetRole: z.string().trim().max(120).optional(),
  targetSeniority: z.enum(INTERVIEW_SENIORITIES).optional(),
  planId: z.string().uuid().optional(),
});
export type StartSessionInput = z.infer<typeof startSessionSchema>;

/** POST /interview/sessions/:id/reply — the candidate's answer. */
export const sessionReplySchema = z.object({
  answer: z.string().trim().min(1).max(8000),
});
export type SessionReplyInput = z.infer<typeof sessionReplySchema>;
