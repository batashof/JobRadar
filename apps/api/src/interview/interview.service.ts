import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  GeneratePlanInput,
  GenerateQuestionsInput,
  InterviewAnswerReview,
  InterviewModelAnswerResponse,
  InterviewPlanDetail,
  InterviewPlanStructure,
  InterviewQuestionItem,
  InterviewQuestionKind,
  InterviewSeniority,
  InterviewTopicProgressItem,
  UpdateTopicProgressInput,
} from '@jobradar/shared';
import { and, desc, eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import {
  interviewAnswers,
  interviewPlans,
  interviewQuestions,
  interviewTopicProgress,
} from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { ResumesService } from '../resumes/resumes.service';
import {
  buildModelAnswerPrompt,
  buildPlanPrompt,
  buildQuestionsPrompt,
  buildReviewPrompt,
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
  // Helpers
  // -------------------------------------------------------------------------

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
