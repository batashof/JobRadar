import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  GeneratePlanInput,
  GenerateQuestionsInput,
  InterviewAnswerReview,
  InterviewFeedback,
  InterviewModelAnswerResponse,
  InterviewPlanDetail,
  InterviewPlanStructure,
  InterviewQuestionItem,
  InterviewQuestionKind,
  InterviewSeniority,
  InterviewSessionDetail,
  InterviewSessionStatus,
  InterviewTopicProgressItem,
  InterviewTurn,
  StartSessionInput,
  UpdateTopicProgressInput,
} from '@jobradar/shared';
import { and, desc, eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import {
  interviewAnswers,
  interviewPlans,
  interviewQuestions,
  interviewSessions,
  interviewTopicProgress,
} from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { ResumesService } from '../resumes/resumes.service';
import {
  buildFeedbackPrompt,
  buildInterviewerPrompt,
  buildModelAnswerPrompt,
  buildPlanPrompt,
  buildQuestionsPrompt,
  buildReviewPrompt,
  cleanInterviewerReply,
  parseFeedbackReply,
  parsePlanReply,
  parseQuestionsReply,
  parseReviewReply,
} from './prompts';

interface PlanRow {
  id: string;
  targetRole: string | null;
  targetSeniority: string | null;
  focus: string[];
  structure: InterviewPlanStructure;
  createdAt: Date;
}

interface QuestionRow {
  id: string;
  planId: string | null;
  topic: string;
  kind: InterviewQuestionKind;
  difficulty: string | null;
  prompt: string;
  modelAnswer: string | null;
  createdAt: Date;
}

interface SessionRow {
  id: string;
  targetRole: string | null;
  targetSeniority: string | null;
  status: InterviewSessionStatus;
  transcript: InterviewTurn[];
  feedback: InterviewFeedback | null;
  startedAt: Date;
  endedAt: Date | null;
}

@Injectable()
export class InterviewService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
    private readonly resumes: ResumesService,
  ) {}

  // -------------------------------------------------------------------------
  // Prep plan
  // -------------------------------------------------------------------------

  /** The user's active plan with per-topic progress, or null when none exists. */
  async getActivePlan(userId: string): Promise<InterviewPlanDetail | null> {
    const [plan] = await this.db
      .select(planColumns)
      .from(interviewPlans)
      .where(and(eq(interviewPlans.userId, userId), eq(interviewPlans.isActive, true)))
      .orderBy(desc(interviewPlans.createdAt))
      .limit(1);
    if (!plan) return null;

    const progress = await this.loadProgress(plan.id);
    return toPlanDetail(plan, progress);
  }

  /**
   * Builds a resume-driven plan via the LLM, makes it the active plan, and
   * keeps older plans as history. Generated on explicit action only (ADR-013).
   */
  async generatePlan(userId: string, input: GeneratePlanInput): Promise<InterviewPlanDetail> {
    const resume = await this.resumes.getActive(userId);
    if (!resume) {
      throw new BadRequestException('Upload a resume first — the plan is built from it');
    }
    if (!resume.extractedText) {
      throw new BadRequestException(
        'No text could be extracted from the active resume — upload a text-based PDF',
      );
    }

    const prompt = buildPlanPrompt(resume.extractedText, {
      targetRole: input.targetRole,
      targetSeniority: input.targetSeniority,
      focus: input.focus,
    });
    const result = await this.llm.complete({ ...prompt, maxTokens: 1600, temperature: 0.3 });
    const structure = parsePlanReply(result.text);
    if (!structure) {
      throw new BadRequestException('Could not build a plan — please try again');
    }

    const plan = await this.db.transaction(async (tx) => {
      await tx
        .update(interviewPlans)
        .set({ isActive: false })
        .where(eq(interviewPlans.userId, userId));
      const [inserted] = await tx
        .insert(interviewPlans)
        .values({
          userId,
          resumeId: resume.id,
          targetRole: input.targetRole ?? null,
          targetSeniority: input.targetSeniority ?? null,
          focus: input.focus ?? [],
          structure,
          isActive: true,
        })
        .returning(planColumns);
      if (!inserted) throw new Error('Interview plan insert returned no row');
      return inserted;
    });

    return toPlanDetail(plan, []);
  }

  /** Upserts a topic's progress within the user's plan. */
  async updateProgress(
    userId: string,
    planId: string,
    input: UpdateTopicProgressInput,
  ): Promise<InterviewTopicProgressItem> {
    const plan = await this.loadOwnedPlan(userId, planId);

    const known = plan.structure.sections.some((s) =>
      s.topics.some((t) => t.key === input.topicKey),
    );
    if (!known) throw new NotFoundException('Topic not found in this plan');

    const confidence = input.confidence ?? null;
    const now = new Date();
    const [row] = await this.db
      .insert(interviewTopicProgress)
      .values({ planId, topicKey: input.topicKey, status: input.status, confidence, updatedAt: now })
      .onConflictDoUpdate({
        target: [interviewTopicProgress.planId, interviewTopicProgress.topicKey],
        set: { status: input.status, confidence, updatedAt: now },
      })
      .returning({
        topicKey: interviewTopicProgress.topicKey,
        status: interviewTopicProgress.status,
        confidence: interviewTopicProgress.confidence,
        updatedAt: interviewTopicProgress.updatedAt,
      });
    if (!row) throw new Error('Progress upsert returned no row');
    return { ...row, updatedAt: row.updatedAt.toISOString() };
  }

  // -------------------------------------------------------------------------
  // Questions
  // -------------------------------------------------------------------------

  /** Generates and stores questions for a topic; returns the new items. */
  async generateQuestions(
    userId: string,
    input: GenerateQuestionsInput,
  ): Promise<InterviewQuestionItem[]> {
    if (input.planId) await this.loadOwnedPlan(userId, input.planId);

    const resume = await this.resumes.getActive(userId);
    const count = input.count ?? 3;
    const prompt = buildQuestionsPrompt({
      topic: input.topic,
      kind: input.kind,
      difficulty: input.difficulty,
      count,
      resumeText: resume?.extractedText || null,
    });
    const result = await this.llm.complete({ ...prompt, maxTokens: 1200, temperature: 0.6 });
    const prompts = parseQuestionsReply(result.text).slice(0, count);
    if (prompts.length === 0) {
      throw new BadRequestException('Could not generate questions — please try again');
    }

    const rows = await this.db
      .insert(interviewQuestions)
      .values(
        prompts.map((p) => ({
          userId,
          planId: input.planId ?? null,
          topic: input.topic,
          kind: input.kind,
          difficulty: input.difficulty ?? null,
          prompt: p,
        })),
      )
      .returning(questionColumns);
    return rows.map(toQuestionItem);
  }

  /** Recent questions for the user, optionally filtered by topic/plan. */
  async listQuestions(
    userId: string,
    filter: { topic?: string; planId?: string },
  ): Promise<InterviewQuestionItem[]> {
    const conditions = [eq(interviewQuestions.userId, userId)];
    if (filter.topic) conditions.push(eq(interviewQuestions.topic, filter.topic));
    if (filter.planId) conditions.push(eq(interviewQuestions.planId, filter.planId));

    const rows = await this.db
      .select(questionColumns)
      .from(interviewQuestions)
      .where(and(...conditions))
      .orderBy(desc(interviewQuestions.createdAt))
      .limit(50);
    return rows.map(toQuestionItem);
  }

  /** Reveals (and caches) the model answer for a question. */
  async revealModelAnswer(
    userId: string,
    questionId: string,
  ): Promise<InterviewModelAnswerResponse> {
    const question = await this.loadOwnedQuestion(userId, questionId);
    if (question.modelAnswer) {
      return { modelAnswer: question.modelAnswer, cached: true };
    }

    const prompt = buildModelAnswerPrompt(question.kind, question.prompt);
    const result = await this.llm.complete({ ...prompt, maxTokens: 900, temperature: 0.3 });
    await this.db
      .update(interviewQuestions)
      .set({ modelAnswer: result.text })
      .where(eq(interviewQuestions.id, questionId));
    return { modelAnswer: result.text, cached: false };
  }

  /**
   * Reviews a submitted answer / live-coding solution. The code is reviewed,
   * never executed (ADR-013). Each attempt is stored.
   */
  async reviewAnswer(
    userId: string,
    questionId: string,
    answer: string,
  ): Promise<InterviewAnswerReview> {
    const question = await this.loadOwnedQuestion(userId, questionId);

    const prompt = buildReviewPrompt(question.kind, question.prompt, answer);
    const result = await this.llm.complete({ ...prompt, maxTokens: 700, temperature: 0.2 });
    const parsed = parseReviewReply(result.text);
    if (!parsed) {
      throw new BadRequestException('Could not review this answer — please try again');
    }

    const [row] = await this.db
      .insert(interviewAnswers)
      .values({
        questionId,
        userId,
        answer,
        review: parsed.review,
        score: parsed.score,
      })
      .returning({ id: interviewAnswers.id });
    if (!row) throw new Error('Interview answer insert returned no row');

    return { answerId: row.id, score: parsed.score, review: parsed.review };
  }

  // -------------------------------------------------------------------------
  // Mock interview (text chat)
  // -------------------------------------------------------------------------

  /** The user's latest in-progress mock interview, or null. */
  async getActiveSession(userId: string): Promise<InterviewSessionDetail | null> {
    const [row] = await this.db
      .select(sessionColumns)
      .from(interviewSessions)
      .where(and(eq(interviewSessions.userId, userId), eq(interviewSessions.status, 'in_progress')))
      .orderBy(desc(interviewSessions.startedAt))
      .limit(1);
    return row ? toSessionDetail(row) : null;
  }

  async getSession(userId: string, id: string): Promise<InterviewSessionDetail> {
    return toSessionDetail(await this.loadOwnedSession(userId, id));
  }

  /** Starts a mock interview; the interviewer opens with the first message. */
  async startSession(userId: string, input: StartSessionInput): Promise<InterviewSessionDetail> {
    const resume = await this.resumes.getActive(userId);
    if (!resume) {
      throw new BadRequestException('Upload a resume first — the interview is based on it');
    }
    if (!resume.extractedText) {
      throw new BadRequestException(
        'No text could be extracted from the active resume — upload a text-based PDF',
      );
    }

    let targetRole = input.targetRole ?? null;
    let targetSeniority = input.targetSeniority ?? null;
    if (input.planId) {
      const plan = await this.loadOwnedPlan(userId, input.planId);
      targetRole ??= plan.targetRole;
      targetSeniority ??= plan.targetSeniority as InterviewSeniority | null;
    }

    const prompt = buildInterviewerPrompt({ targetRole, targetSeniority }, resume.extractedText, []);
    const result = await this.llm.complete({ ...prompt, maxTokens: 400, temperature: 0.6 });
    const opening: InterviewTurn = {
      role: 'interviewer',
      content: cleanInterviewerReply(result.text),
      at: new Date().toISOString(),
    };

    const [row] = await this.db
      .insert(interviewSessions)
      .values({
        userId,
        planId: input.planId ?? null,
        targetRole,
        targetSeniority,
        transcript: [opening],
      })
      .returning(sessionColumns);
    if (!row) throw new Error('Interview session insert returned no row');
    return toSessionDetail(row);
  }

  /** Records the candidate's answer and returns the interviewer's next message. */
  async reply(userId: string, id: string, answer: string): Promise<InterviewSessionDetail> {
    const session = await this.loadOwnedSession(userId, id);
    if (session.status !== 'in_progress') {
      throw new BadRequestException('This interview has already ended');
    }
    const resume = await this.resumes.getActive(userId);
    if (!resume?.extractedText) {
      throw new BadRequestException('The active resume is no longer available');
    }

    const now = new Date().toISOString();
    const withCandidate: InterviewTurn[] = [
      ...session.transcript,
      { role: 'candidate', content: answer, at: now },
    ];

    const prompt = buildInterviewerPrompt(
      { targetRole: session.targetRole, targetSeniority: session.targetSeniority },
      resume.extractedText,
      withCandidate,
    );
    const result = await this.llm.complete({ ...prompt, maxTokens: 400, temperature: 0.6 });
    const transcript: InterviewTurn[] = [
      ...withCandidate,
      {
        role: 'interviewer',
        content: cleanInterviewerReply(result.text),
        at: new Date().toISOString(),
      },
    ];

    const [row] = await this.db
      .update(interviewSessions)
      .set({ transcript })
      .where(eq(interviewSessions.id, id))
      .returning(sessionColumns);
    if (!row) throw new Error('Interview session update returned no row');
    return toSessionDetail(row);
  }

  /** Ends the interview and produces the written feedback report. */
  async finishSession(userId: string, id: string): Promise<InterviewSessionDetail> {
    const session = await this.loadOwnedSession(userId, id);
    if (session.status !== 'in_progress') return toSessionDetail(session);
    if (!session.transcript.some((t) => t.role === 'candidate')) {
      throw new BadRequestException('Answer at least one question before ending the interview');
    }

    const prompt = buildFeedbackPrompt(
      { targetRole: session.targetRole, targetSeniority: session.targetSeniority },
      session.transcript,
    );
    const result = await this.llm.complete({ ...prompt, maxTokens: 700, temperature: 0.3 });
    const feedback = parseFeedbackReply(result.text);
    if (!feedback) {
      throw new BadRequestException('Could not generate feedback — please try again');
    }

    const [row] = await this.db
      .update(interviewSessions)
      .set({ status: 'completed', feedback, endedAt: new Date() })
      .where(eq(interviewSessions.id, id))
      .returning(sessionColumns);
    if (!row) throw new Error('Interview session update returned no row');
    return toSessionDetail(row);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async loadOwnedSession(userId: string, id: string): Promise<SessionRow> {
    const [session] = await this.db
      .select(sessionColumns)
      .from(interviewSessions)
      .where(and(eq(interviewSessions.id, id), eq(interviewSessions.userId, userId)));
    if (!session) throw new NotFoundException('Interview session not found');
    return session;
  }

  private async loadProgress(planId: string): Promise<InterviewTopicProgressItem[]> {
    const rows = await this.db
      .select({
        topicKey: interviewTopicProgress.topicKey,
        status: interviewTopicProgress.status,
        confidence: interviewTopicProgress.confidence,
        updatedAt: interviewTopicProgress.updatedAt,
      })
      .from(interviewTopicProgress)
      .where(eq(interviewTopicProgress.planId, planId));
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  }

  private async loadOwnedPlan(userId: string, planId: string): Promise<PlanRow> {
    const [plan] = await this.db
      .select(planColumns)
      .from(interviewPlans)
      .where(and(eq(interviewPlans.id, planId), eq(interviewPlans.userId, userId)));
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  private async loadOwnedQuestion(userId: string, questionId: string): Promise<QuestionRow> {
    const [question] = await this.db
      .select(questionColumns)
      .from(interviewQuestions)
      .where(and(eq(interviewQuestions.id, questionId), eq(interviewQuestions.userId, userId)));
    if (!question) throw new NotFoundException('Question not found');
    return question;
  }
}

const planColumns = {
  id: interviewPlans.id,
  targetRole: interviewPlans.targetRole,
  targetSeniority: interviewPlans.targetSeniority,
  focus: interviewPlans.focus,
  structure: interviewPlans.structure,
  createdAt: interviewPlans.createdAt,
};

const questionColumns = {
  id: interviewQuestions.id,
  planId: interviewQuestions.planId,
  topic: interviewQuestions.topic,
  kind: interviewQuestions.kind,
  difficulty: interviewQuestions.difficulty,
  prompt: interviewQuestions.prompt,
  modelAnswer: interviewQuestions.modelAnswer,
  createdAt: interviewQuestions.createdAt,
};

const sessionColumns = {
  id: interviewSessions.id,
  targetRole: interviewSessions.targetRole,
  targetSeniority: interviewSessions.targetSeniority,
  status: interviewSessions.status,
  transcript: interviewSessions.transcript,
  feedback: interviewSessions.feedback,
  startedAt: interviewSessions.startedAt,
  endedAt: interviewSessions.endedAt,
};

function toSessionDetail(row: SessionRow): InterviewSessionDetail {
  return {
    id: row.id,
    targetRole: row.targetRole,
    targetSeniority: row.targetSeniority as InterviewSeniority | null,
    status: row.status,
    transcript: row.transcript ?? [],
    feedback: row.feedback,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

function toPlanDetail(plan: PlanRow, progress: InterviewTopicProgressItem[]): InterviewPlanDetail {
  return {
    id: plan.id,
    targetRole: plan.targetRole,
    targetSeniority: plan.targetSeniority as InterviewSeniority | null,
    focus: plan.focus,
    createdAt: plan.createdAt.toISOString(),
    structure: plan.structure,
    progress,
  };
}

function toQuestionItem(row: QuestionRow): InterviewQuestionItem {
  return {
    id: row.id,
    planId: row.planId,
    topic: row.topic,
    kind: row.kind,
    difficulty: (row.difficulty as InterviewQuestionItem['difficulty']) ?? null,
    prompt: row.prompt,
    hasModelAnswer: row.modelAnswer !== null,
    modelAnswer: row.modelAnswer,
    createdAt: row.createdAt.toISOString(),
  };
}
