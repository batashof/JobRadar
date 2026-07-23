import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AddPlanBlockInput,
  type CreateDayPlanInput,
  type DayPlanDetail,
  type DropPlanBlockInput,
  type Language,
  localDayKey,
  type PlanBlockItem,
  type PlanCandidatesResponse,
  type PlannerSettings,
  type PlannerTodayResponse,
  PLANNER_DEFAULTS,
  correctEstimate,
  type ReorderPlanBlocksInput,
  type UpdatePlanBlockInput,
  type UpdatePlannerSettingsInput,
} from '@jobradar/shared';
import { and, asc, eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { dayPlans, planBlocks, plannerSettings } from '../db/schema';
import { CandidatesService } from './candidates.service';

type SettingsRow = typeof plannerSettings.$inferSelect;
type PlanRow = typeof dayPlans.$inferSelect;
type BlockRow = typeof planBlocks.$inferSelect;

/** Blocks that are finished one way or another and must not be edited. */
const TERMINAL_STATUSES = ['done', 'dropped'] as const;

/** Max blocks in one day — the plan is a commitment, not a backlog (ADR-015). */
const MAX_BLOCKS = 20;

@Injectable()
export class PlannerService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly candidates: CandidatesService,
  ) {}

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  /** Reads the user's settings, creating the default row on first use. */
  async getSettings(userId: string): Promise<PlannerSettings> {
    return toSettings(await this.settingsRow(userId));
  }

  async updateSettings(
    userId: string,
    input: UpdatePlannerSettingsInput,
  ): Promise<PlannerSettings> {
    await this.settingsRow(userId);
    if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
      throw new BadRequestException(`Unknown timezone: ${input.timezone}`);
    }
    const [row] = await this.db
      .update(plannerSettings)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(plannerSettings.userId, userId))
      .returning();
    return toSettings(requireRow(row, 'Planner settings not found'));
  }

  private async settingsRow(userId: string): Promise<SettingsRow> {
    const [existing] = await this.db
      .select()
      .from(plannerSettings)
      .where(eq(plannerSettings.userId, userId));
    if (existing) return existing;

    const [created] = await this.db
      .insert(plannerSettings)
      .values({ userId })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    // Lost the race with a concurrent request — the row exists now.
    const [row] = await this.db
      .select()
      .from(plannerSettings)
      .where(eq(plannerSettings.userId, userId));
    return requireRow(row, 'Planner settings not found');
  }

  // -------------------------------------------------------------------------
  // Today's plan
  // -------------------------------------------------------------------------

  async getToday(userId: string): Promise<PlannerTodayResponse> {
    const settings = await this.settingsRow(userId);
    const today = localDayKey(new Date(), settings.timezone);
    const plan = await this.findPlan(userId, today);
    return {
      today,
      plan: plan ? await this.toDetail(plan) : null,
      settings: toSettings(settings),
    };
  }

  /** Starts today's plan. Idempotent: a second call returns the existing plan. */
  async createPlan(userId: string, input: CreateDayPlanInput): Promise<DayPlanDetail> {
    const settings = await this.settingsRow(userId);
    const today = localDayKey(new Date(), settings.timezone);

    const existing = await this.findPlan(userId, today);
    if (existing) return this.toDetail(existing);

    const [plan] = await this.db
      .insert(dayPlans)
      .values({ userId, planDate: today, intent: input.intent ?? null, generatedBy: 'manual' })
      .onConflictDoNothing()
      .returning();
    if (plan) return this.toDetail(plan);

    return this.toDetail(await this.requirePlan(userId, today));
  }

  /**
   * The morning ritual: the plan has to be taken on explicitly. Until it is,
   * the day counts as unplanned (ADR-015 §3).
   */
  async acceptPlan(userId: string, planId: string): Promise<DayPlanDetail> {
    const plan = await this.requirePlanById(userId, planId);
    if (plan.status === 'closed') {
      throw new ConflictException('This day is already closed');
    }
    if (plan.status === 'accepted') return this.toDetail(plan);

    const blocks = await this.loadBlocks(plan.id);
    if (blocks.every((block) => block.status === 'dropped')) {
      throw new BadRequestException('Add at least one block before accepting the day');
    }

    const [updated] = await this.db
      .update(dayPlans)
      .set({ status: 'accepted', acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(dayPlans.id, plan.id))
      .returning();
    return this.toDetail(requireRow(updated, 'Plan not found'));
  }

  /** Free-text "what today is about"; editable while the day is open. */
  async setIntent(userId: string, planId: string, intent: string | null): Promise<DayPlanDetail> {
    const plan = await this.requirePlanById(userId, planId);
    const [updated] = await this.db
      .update(dayPlans)
      .set({ intent, updatedAt: new Date() })
      .where(eq(dayPlans.id, plan.id))
      .returning();
    return this.toDetail(requireRow(updated, 'Plan not found'));
  }

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  async addBlock(userId: string, input: AddPlanBlockInput): Promise<DayPlanDetail> {
    const settings = await this.settingsRow(userId);
    const today = localDayKey(new Date(), settings.timezone);
    const plan = (await this.findPlan(userId, today)) ?? (await this.createPlanRow(userId, today));
    if (plan.status === 'closed') {
      throw new ConflictException('This day is already closed');
    }

    const blocks = await this.loadBlocks(plan.id);
    if (blocks.length >= MAX_BLOCKS) {
      throw new BadRequestException(`A day holds at most ${MAX_BLOCKS} blocks`);
    }

    const estimate = input.estimateMinutes ?? settings.defaultBlockMinutes;
    const carried = input.carriedFromBlockId
      ? await this.requireOwnBlock(userId, input.carriedFromBlockId)
      : null;

    await this.db.insert(planBlocks).values({
      planId: plan.id,
      userId,
      position: nextPosition(blocks),
      title: input.title,
      details: input.details ?? null,
      category: input.category,
      sourceKind: input.sourceKind ?? 'manual',
      sourceRef: input.sourceRef ?? null,
      estimateMinutes: estimate,
      correctedEstimateMinutes: correctEstimate(estimate, settings.estimationFactor),
      carriedFromBlockId: carried?.id ?? null,
      carryCount: carried ? carried.carryCount + 1 : 0,
    });

    return this.toDetail(plan);
  }

  async updateBlock(
    userId: string,
    blockId: string,
    input: UpdatePlanBlockInput,
  ): Promise<DayPlanDetail> {
    const block = await this.requireOwnBlock(userId, blockId);
    if ((TERMINAL_STATUSES as readonly string[]).includes(block.status)) {
      throw new ConflictException('This block is already finished');
    }
    const settings = await this.settingsRow(userId);

    await this.db
      .update(planBlocks)
      .set({
        ...input,
        ...(input.estimateMinutes !== undefined
          ? {
              correctedEstimateMinutes: correctEstimate(
                input.estimateMinutes,
                settings.estimationFactor,
              ),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(planBlocks.id, block.id));

    return this.toDetail(await this.requirePlanById(userId, block.planId));
  }

  /**
   * Dropping is a deliberate, recorded act — the row stays with status
   * `dropped` and a reason, so avoidance is visible instead of silent (ADR-015 §4).
   */
  async dropBlock(
    userId: string,
    blockId: string,
    input: DropPlanBlockInput,
  ): Promise<DayPlanDetail> {
    const block = await this.requireOwnBlock(userId, blockId);
    await this.db
      .update(planBlocks)
      .set({
        status: 'dropped',
        skipReason: input.reason ?? 'changed_priority',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(planBlocks.id, block.id));

    return this.toDetail(await this.requirePlanById(userId, block.planId));
  }

  /** Full-list reorder: the client sends the queue as it should end up. */
  async reorder(
    userId: string,
    planId: string,
    input: ReorderPlanBlocksInput,
  ): Promise<DayPlanDetail> {
    const plan = await this.requirePlanById(userId, planId);
    const blocks = await this.loadBlocks(plan.id);
    const known = new Set(blocks.map((block) => block.id));
    if (input.blockIds.length !== known.size || input.blockIds.some((id) => !known.has(id))) {
      throw new BadRequestException("blockIds must list exactly this plan's blocks");
    }

    await this.db.transaction(async (tx) => {
      for (const [position, id] of input.blockIds.entries()) {
        await tx
          .update(planBlocks)
          .set({ position, updatedAt: new Date() })
          .where(eq(planBlocks.id, id));
      }
    });

    return this.toDetail(plan);
  }

  // -------------------------------------------------------------------------
  // Candidates
  // -------------------------------------------------------------------------

  /** What could go into today's plan, minus what is already in it. */
  async getCandidates(userId: string, lang: Language): Promise<PlanCandidatesResponse> {
    const settings = await this.settingsRow(userId);
    const today = localDayKey(new Date(), settings.timezone);
    const collected = await this.candidates.collect(userId, lang, today);

    const plan = await this.findPlan(userId, today);
    if (!plan) return collected;

    const blocks = await this.loadBlocks(plan.id);
    const taken = new Set(blocks.map(blockCandidateKey).filter((key): key is string => key !== null));
    return {
      ...collected,
      candidates: collected.candidates.filter((candidate) => !taken.has(candidate.key)),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async createPlanRow(userId: string, planDate: string): Promise<PlanRow> {
    const [plan] = await this.db
      .insert(dayPlans)
      .values({ userId, planDate, generatedBy: 'manual' })
      .onConflictDoNothing()
      .returning();
    return plan ?? (await this.requirePlan(userId, planDate));
  }

  private async findPlan(userId: string, planDate: string): Promise<PlanRow | undefined> {
    const [plan] = await this.db
      .select()
      .from(dayPlans)
      .where(and(eq(dayPlans.userId, userId), eq(dayPlans.planDate, planDate)));
    return plan;
  }

  private async requirePlan(userId: string, planDate: string): Promise<PlanRow> {
    const plan = await this.findPlan(userId, planDate);
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  private async requirePlanById(userId: string, planId: string): Promise<PlanRow> {
    const [plan] = await this.db
      .select()
      .from(dayPlans)
      .where(and(eq(dayPlans.id, planId), eq(dayPlans.userId, userId)));
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  private async requireOwnBlock(userId: string, blockId: string): Promise<BlockRow> {
    const [block] = await this.db
      .select()
      .from(planBlocks)
      .where(and(eq(planBlocks.id, blockId), eq(planBlocks.userId, userId)));
    if (!block) throw new NotFoundException('Block not found');
    return block;
  }

  private loadBlocks(planId: string): Promise<BlockRow[]> {
    return this.db
      .select()
      .from(planBlocks)
      .where(eq(planBlocks.planId, planId))
      .orderBy(asc(planBlocks.position), asc(planBlocks.createdAt));
  }

  private async toDetail(plan: PlanRow): Promise<DayPlanDetail> {
    const blocks = await this.loadBlocks(plan.id);
    return {
      id: plan.id,
      planDate: plan.planDate,
      status: plan.status,
      generatedBy: plan.generatedBy,
      intent: plan.intent,
      acceptedAt: plan.acceptedAt?.toISOString() ?? null,
      closedAt: plan.closedAt?.toISOString() ?? null,
      autoClosed: plan.autoClosed,
      review: plan.review ?? null,
      blocks: blocks.map(toBlockItem),
    };
  }
}

/** Narrows the `[row] = await …` destructuring, which is always optional. */
function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new NotFoundException(message);
  return row;
}

function nextPosition(blocks: BlockRow[]): number {
  return blocks.reduce((max, block) => Math.max(max, block.position + 1), 0);
}

/**
 * The candidate key a block occupies, so an already-planned item is not offered
 * twice. Manual blocks answer to no candidate.
 */
export function blockCandidateKey(block: Pick<BlockRow, 'sourceKind' | 'sourceRef' | 'carriedFromBlockId'>): string | null {
  if (block.carriedFromBlockId) return `debt:${block.carriedFromBlockId}`;
  const ref = block.sourceRef;
  if (!ref) return null;
  if (block.sourceKind === 'application_followup' && ref.applicationId) {
    return `application_followup:${ref.applicationId}`;
  }
  if (block.sourceKind === 'interview_topic' && ref.topicKey) {
    return `interview_topic:${ref.topicKey}`;
  }
  if (block.sourceKind === 'vacancy_apply' && ref.vacancyId) {
    return `vacancy_apply:${ref.vacancyId}`;
  }
  return null;
}

function toBlockItem(block: BlockRow): PlanBlockItem {
  return {
    id: block.id,
    position: block.position,
    title: block.title,
    details: block.details,
    category: block.category,
    sourceKind: block.sourceKind,
    sourceRef: block.sourceRef ?? null,
    estimateMinutes: block.estimateMinutes,
    correctedEstimateMinutes: block.correctedEstimateMinutes,
    actualMinutes: block.actualMinutes,
    status: block.status,
    skipReason: block.skipReason,
    outcomeNote: block.outcomeNote,
    carriedFromBlockId: block.carriedFromBlockId,
    carryCount: block.carryCount,
    startedAt: block.startedAt?.toISOString() ?? null,
    completedAt: block.completedAt?.toISOString() ?? null,
  };
}

function toSettings(row: SettingsRow): PlannerSettings {
  return {
    timezone: row.timezone,
    morningRitualAt: trimTime(row.morningRitualAt),
    eveningReviewAt: trimTime(row.eveningReviewAt),
    capacityMinutes: row.capacityMinutes,
    defaultBlockMinutes: row.defaultBlockMinutes,
    categoryTargets: row.categoryTargets ?? null,
    telegramChatId: row.telegramChatId,
    telegramEnabled: row.telegramEnabled,
    escalationAfterMinutes: row.escalationAfterMinutes,
    escalationMaxRepeats: row.escalationMaxRepeats,
    estimationFactor: row.estimationFactor ?? PLANNER_DEFAULTS.estimationFactor,
    estimationFactorByCategory: row.estimationFactorByCategory ?? null,
  };
}

/** Postgres returns `time` as `HH:MM:SS`; the contract is `HH:MM`. */
function trimTime(value: string): string {
  return value.slice(0, 5);
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
