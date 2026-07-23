import { Inject, Injectable } from '@nestjs/common';
import {
  type InterviewPlanStructure,
  type Language,
  type PlanCandidate,
  type PlanCandidatesResponse,
  PLAN_BLOCK_UNFINISHED_STATUSES,
  REMINDER_DEFAULT_DAYS,
  REMINDER_STAGES,
} from '@jobradar/shared';
import { and, asc, desc, eq, inArray, isNull, lt, notExists, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import {
  applications,
  dayPlans,
  interviewPlans,
  interviewTopicProgress,
  planBlocks,
  profileMatches,
  searchProfiles,
  vacancies,
} from '../db/schema';
import { plannerLabel } from './labels';

/** Default timeboxes per candidate kind, before the estimation factor. */
const ESTIMATES = { followUp: 15, apply: 30, topic: 45 } as const;

/** Per-kind caps: the point is a short, doable list, not an inbox. */
const LIMITS = { followUp: 5, topic: 3, apply: 5, debt: 10 } as const;

/**
 * Collects what could go into today's plan straight from app state — plain SQL,
 * no LLM (ADR-015 §2). The LLM increment will select and sequence from exactly
 * this list; nothing here is ever invented.
 */
@Injectable()
export class CandidatesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async collect(
    userId: string,
    lang: Language,
    today: string,
  ): Promise<PlanCandidatesResponse> {
    const [debtRows, followUps, topics, applies] = await Promise.all([
      this.debt(userId, today),
      this.followUps(userId, lang),
      this.interviewTopics(userId, lang),
      this.vacanciesToApply(userId, lang),
    ]);

    // Debt first, always: yesterday's leftovers outrank anything new (ADR-015 §4).
    const candidates = [
      ...debtRows.map((row) => toDebtCandidate(row, lang)),
      ...followUps,
      ...topics,
      ...applies,
    ];

    return {
      candidates,
      debt: {
        count: debtRows.length,
        minutes: debtRows.reduce((total, row) => total + row.correctedEstimateMinutes, 0),
      },
    };
  }

  /**
   * Blocks left unfinished on earlier days and not yet carried into a later
   * plan. Independent of the close-out flow, so it is correct whether the day
   * was closed by the user or auto-closed.
   */
  private async debt(userId: string, today: string) {
    const rows = await this.db
      .select({
        id: planBlocks.id,
        title: planBlocks.title,
        details: planBlocks.details,
        category: planBlocks.category,
        sourceRef: planBlocks.sourceRef,
        estimateMinutes: planBlocks.estimateMinutes,
        correctedEstimateMinutes: planBlocks.correctedEstimateMinutes,
        carryCount: planBlocks.carryCount,
        planDate: dayPlans.planDate,
      })
      .from(planBlocks)
      .innerJoin(dayPlans, eq(planBlocks.planId, dayPlans.id))
      .where(
        and(
          eq(planBlocks.userId, userId),
          lt(dayPlans.planDate, today),
          inArray(planBlocks.status, [...PLAN_BLOCK_UNFINISHED_STATUSES]),
        ),
      )
      .orderBy(desc(planBlocks.carryCount), asc(dayPlans.planDate))
      // Over-fetch: some of these may already have been carried forward.
      .limit(LIMITS.debt * 2);
    if (rows.length === 0) return rows;

    const carried = await this.db
      .select({ from: planBlocks.carriedFromBlockId })
      .from(planBlocks)
      .where(
        inArray(
          planBlocks.carriedFromBlockId,
          rows.map((row) => row.id),
        ),
      );
    const alreadyCarried = new Set(carried.map((row) => row.from));
    return rows.filter((row) => !alreadyCarried.has(row.id)).slice(0, LIMITS.debt);
  }

  /** Applications waiting past their reminder threshold (same rule as the dashboard). */
  private async followUps(userId: string, lang: Language): Promise<PlanCandidate[]> {
    const elapsedDays = sql<number>`floor(extract(epoch from (now() - ${applications.lastActivityAt})) / 86400)`;
    const rows = await this.db
      .select({
        id: applications.id,
        stage: applications.stage,
        days: elapsedDays,
        vacancyId: vacancies.id,
        company: vacancies.companyRaw,
        title: vacancies.title,
      })
      .from(applications)
      .innerJoin(vacancies, eq(applications.vacancyId, vacancies.id))
      .where(
        and(
          eq(applications.userId, userId),
          inArray(applications.stage, [...REMINDER_STAGES]),
          sql`${elapsedDays} >= coalesce(${applications.remindAfterDays}, ${REMINDER_DEFAULT_DAYS})`,
        ),
      )
      .orderBy(desc(elapsedDays))
      .limit(LIMITS.followUp);

    return rows.map((row) => ({
      key: `application_followup:${row.id}`,
      sourceKind: 'application_followup',
      category: 'job_search',
      title: plannerLabel(lang, 'followup.title', { company: row.company }),
      reason: plannerLabel(lang, 'followup.reason', {
        days: Math.max(0, Math.trunc(Number(row.days))),
        stage: row.stage,
      }),
      sourceRef: { applicationId: row.id, vacancyId: row.vacancyId },
      estimateMinutes: ESTIMATES.followUp,
    }));
  }

  /** Topics of the active prep plan that are not done yet (ADR-013). */
  private async interviewTopics(userId: string, lang: Language): Promise<PlanCandidate[]> {
    const [plan] = await this.db
      .select({ id: interviewPlans.id, structure: interviewPlans.structure })
      .from(interviewPlans)
      .where(and(eq(interviewPlans.userId, userId), eq(interviewPlans.isActive, true)))
      .orderBy(desc(interviewPlans.createdAt))
      .limit(1);
    if (!plan) return [];

    const progress = await this.db
      .select({ topicKey: interviewTopicProgress.topicKey, status: interviewTopicProgress.status })
      .from(interviewTopicProgress)
      .where(eq(interviewTopicProgress.planId, plan.id));
    const doneKeys = new Set(
      progress.filter((row) => row.status === 'done').map((row) => row.topicKey),
    );

    return flattenTopics(plan.structure)
      .filter((topic) => !doneKeys.has(topic.key))
      .slice(0, LIMITS.topic)
      .map((topic) => ({
        key: `interview_topic:${topic.key}`,
        sourceKind: 'interview_topic' as const,
        category: 'interview_prep' as const,
        title: plannerLabel(lang, 'topic.title', { topic: topic.title }),
        reason: topic.why || plannerLabel(lang, 'topic.reason'),
        sourceRef: { interviewPlanId: plan.id, topicKey: topic.key },
        estimateMinutes: ESTIMATES.topic,
      }));
  }

  /** Best profile-matched vacancies that are not on the board yet. */
  private async vacanciesToApply(userId: string, lang: Language): Promise<PlanCandidate[]> {
    const alreadyOnBoard = this.db
      .select({ one: sql`1` })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.vacancyId, vacancies.id)));

    const rows = await this.db
      .selectDistinctOn([profileMatches.vacancyId], {
        vacancyId: vacancies.id,
        title: vacancies.title,
        company: vacancies.companyRaw,
        score: profileMatches.score,
      })
      .from(profileMatches)
      .innerJoin(searchProfiles, eq(profileMatches.profileId, searchProfiles.id))
      .innerJoin(vacancies, eq(profileMatches.vacancyId, vacancies.id))
      .where(
        and(
          eq(searchProfiles.userId, userId),
          eq(searchProfiles.isActive, true),
          isNull(vacancies.canonicalVacancyId),
          notExists(alreadyOnBoard),
        ),
      )
      .orderBy(asc(profileMatches.vacancyId), desc(profileMatches.score))
      .limit(LIMITS.apply);

    return rows.map((row) => ({
      key: `vacancy_apply:${row.vacancyId}`,
      sourceKind: 'vacancy_apply',
      category: 'job_search',
      title: plannerLabel(lang, 'apply.title', { title: row.title, company: row.company }),
      reason: plannerLabel(lang, 'apply.reason', { score: Math.round(row.score * 100) }),
      sourceRef: { vacancyId: row.vacancyId },
      estimateMinutes: ESTIMATES.apply,
    }));
  }
}

type DebtRow = Awaited<ReturnType<CandidatesService['debt']>>[number];

function toDebtCandidate(row: DebtRow, lang: Language): PlanCandidate {
  return {
    key: `debt:${row.id}`,
    sourceKind: 'debt',
    category: row.category,
    title: plannerLabel(lang, 'debt.title', { title: row.title }),
    reason: plannerLabel(lang, 'debt.reason', {
      date: row.planDate,
      count: row.carryCount + 1,
    }),
    sourceRef: row.sourceRef,
    estimateMinutes: row.estimateMinutes,
    carryCount: row.carryCount + 1,
    carriedFromBlockId: row.id,
  };
}

export function flattenTopics(structure: InterviewPlanStructure) {
  return structure.sections.flatMap((section) => section.topics);
}
