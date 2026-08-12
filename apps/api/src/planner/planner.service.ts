import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type AddPlanBlockInput,
  type CloseDayPlanInput,
  type CompletePlanBlockInput,
  type CreateDayPlanInput,
  type DayPlanDetail,
  type DropPlanBlockInput,
  ESTIMATION_WINDOW,
  type GenerateDayPlanInput,
  estimationFactor,
  isValidTimezone,
  type Language,
  localDayKey,
  type PlanBlockCategory,
  type PlanBlockItem,
  PLAN_BLOCK_CATEGORIES,
  type PlanCandidate,
  type PlanCandidatesResponse,
  type PlannerNudgeItem,
  type PlannerSettings,
  type PlannerTodayResponse,
  PLANNER_DEFAULTS,
  correctEstimate,
  plannedMinutes,
  type ReorderPlanBlocksInput,
  summarizeDay,
  type UpdatePlanBlockInput,
  type UpdatePlannerSettingsInput,
} from '@jobradar/shared';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { dayPlans, focusSessions, planBlocks, plannerNudges, plannerSettings } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { CandidatesService } from './candidates.service';
import { fallbackCompose, fitToCapacity } from './compose';
import { buildComposePrompt, type ComposedBlock, parseComposeReply } from './prompts';

type SettingsRow = typeof plannerSettings.$inferSelect;
type PlanRow = typeof dayPlans.$inferSelect;
type BlockRow = typeof planBlocks.$inferSelect;

/** Blocks that are finished one way or another and must not be edited. */
const TERMINAL_STATUSES: readonly string[] = ['done', 'dropped', 'partial', 'skipped'];

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Max blocks in one day — the plan is a commitment, not a backlog (ADR-015). */
const MAX_BLOCKS = 20;

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly candidates: CandidatesService,
    private readonly llm: LlmService,
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
      nudges: await this.listNudges(userId),
    };
  }

  // -------------------------------------------------------------------------
  // Nudges (ADR-015 §6). Delivery is in-app until a bot token exists; the tick
  // writes the rows, this is the read side.
  // -------------------------------------------------------------------------

  /** Nudges the user has not acknowledged yet, newest first. */
  async listNudges(userId: string): Promise<PlannerNudgeItem[]> {
    const rows = await this.db
      .select()
      .from(plannerNudges)
      .where(and(eq(plannerNudges.userId, userId), eq(plannerNudges.status, 'sent')))
      .orderBy(desc(plannerNudges.sentAt))
      .limit(10);

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      blockId: row.blockId,
      repeatIndex: row.repeatIndex,
      sentAt: row.sentAt?.toISOString() ?? null,
    }));
  }

  /** Acknowledging is the user saying "seen" — it stops the escalation. */
  async acknowledgeNudge(userId: string, nudgeId: string): Promise<PlannerNudgeItem[]> {
    const [nudge] = await this.db
      .select()
      .from(plannerNudges)
      .where(and(eq(plannerNudges.id, nudgeId), eq(plannerNudges.userId, userId)));
    if (!nudge) throw new NotFoundException('Nudge not found');

    await this.db
      .update(plannerNudges)
      .set({ status: 'acknowledged', acknowledgedAt: new Date() })
      .where(eq(plannerNudges.id, nudge.id));

    return this.listNudges(userId);
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
   * Composes today's plan from the SQL-collected candidates (ADR-015 §2). The
   * LLM only selects and sequences; if it is unavailable or answers with
   * nothing usable, a deterministic ordering takes over, so the feature never
   * hard-depends on an API key. The result is a **draft** — the morning ritual
   * still requires an explicit accept.
   */
  async generatePlan(
    userId: string,
    lang: Language,
    input: GenerateDayPlanInput,
  ): Promise<DayPlanDetail> {
    const settings = await this.settingsRow(userId);
    const today = localDayKey(new Date(), settings.timezone);
    const plan = (await this.findPlan(userId, today)) ?? (await this.createPlanRow(userId, today));
    if (plan.status === 'closed') throw new ConflictException('This day is already closed');

    const existing = await this.loadBlocks(plan.id);
    if (existing.length > 0 && !input.regenerate) {
      throw new ConflictException(
        'Today already has blocks — pass regenerate to rebuild the untouched ones',
      );
    }

    // Regenerating never destroys work: only untouched, never-started blocks go.
    const untouched = existing.filter(
      (block) => block.status === 'pending' && block.actualMinutes === 0 && !block.startedAt,
    );
    const kept = existing.filter((block) => !untouched.includes(block));
    if (untouched.length > 0) {
      await this.db.delete(planBlocks).where(
        inArray(
          planBlocks.id,
          untouched.map((block) => block.id),
        ),
      );
    }

    const collected = await this.candidates.collect(userId, lang, today);
    const taken = new Set(
      kept.map(blockCandidateKey).filter((key): key is string => key !== null),
    );
    const available = collected.candidates.filter((candidate) => !taken.has(candidate.key));

    const capacityLeft = Math.max(
      0,
      settings.capacityMinutes - plannedMinutes(kept.map(toBlockItem)),
    );
    const { blocks: composed, generatedBy } = await this.compose(available, {
      capacityMinutes: capacityLeft,
      estimationFactor: settings.estimationFactor,
      intent: input.intent ?? plan.intent,
      lang,
    });

    const byKey = new Map(available.map((candidate) => [candidate.key, candidate]));
    let position = nextPosition(kept);
    for (const block of composed) {
      const candidate = byKey.get(block.key);
      if (!candidate) continue;
      const estimate = block.estimateMinutes ?? candidate.estimateMinutes;
      await this.db.insert(planBlocks).values({
        planId: plan.id,
        userId,
        position: position++,
        title: block.title ?? candidate.title,
        details: candidate.reason,
        category: candidate.category,
        sourceKind: candidate.sourceKind,
        sourceRef: candidate.sourceRef ?? null,
        estimateMinutes: estimate,
        correctedEstimateMinutes: correctEstimate(estimate, settings.estimationFactor),
        carriedFromBlockId: candidate.carriedFromBlockId ?? null,
        carryCount: candidate.carryCount ?? 0,
      });
    }

    const [updated] = await this.db
      .update(dayPlans)
      .set({
        generatedBy,
        intent: input.intent ?? plan.intent,
        updatedAt: new Date(),
      })
      .where(eq(dayPlans.id, plan.id))
      .returning();

    return this.toDetail(requireRow(updated, 'Plan not found'));
  }

  /** LLM first, deterministic ordering as the safety net (ADR-005 discipline). */
  private async compose(
    candidates: PlanCandidate[],
    context: {
      capacityMinutes: number;
      estimationFactor: number;
      intent: string | null;
      lang: Language;
    },
  ): Promise<{ blocks: ComposedBlock[]; generatedBy: 'llm' | 'fallback' }> {
    if (candidates.length === 0) return { blocks: [], generatedBy: 'fallback' };

    if (this.llm.isConfigured()) {
      try {
        const prompt = buildComposePrompt(candidates, context);
        const result = await this.llm.complete({ ...prompt, maxTokens: 700, temperature: 0.3 });
        const parsed = parseComposeReply(result.text, candidates);
        const fitted = fitToCapacity(
          parsed,
          candidates,
          context.capacityMinutes,
          context.estimationFactor,
        );
        if (fitted.length > 0) return { blocks: fitted, generatedBy: 'llm' };
        this.logger.warn('LLM returned no usable blocks — falling back to the fixed ordering');
      } catch (err) {
        this.logger.warn(
          `Plan composition fell back to the fixed ordering: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      blocks: fallbackCompose(candidates, context.capacityMinutes, context.estimationFactor),
      generatedBy: 'fallback',
    };
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
    if (isTerminal(block.status)) {
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
  // Focus timer (ADR-015 §5)
  // -------------------------------------------------------------------------

  /**
   * Starts (or resumes) work on a block. At most one session runs per user, so
   * starting a second block banks the first one's time and pauses it.
   */
  async startBlock(userId: string, blockId: string): Promise<DayPlanDetail> {
    const block = await this.requireOwnBlock(userId, blockId);
    const plan = await this.requirePlanById(userId, block.planId);
    if (plan.status === 'closed') throw new ConflictException('This day is already closed');
    if (isTerminal(block.status)) throw new ConflictException('This block is already finished');

    const running = await this.runningSession(userId);
    if (running && running.blockId !== block.id) {
      await this.endSession(running.id, running.blockId, running.startedAt, 'paused');
      await this.db
        .update(planBlocks)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(planBlocks.id, running.blockId));
    }

    if (!running || running.blockId !== block.id) {
      await this.db.insert(focusSessions).values({ blockId: block.id, userId });
    }
    await this.db
      .update(planBlocks)
      .set({
        status: 'active',
        startedAt: block.startedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(planBlocks.id, block.id));

    return this.toDetail(plan);
  }

  /** Stops the clock without resolving the block — it stays in the queue. */
  async pauseBlock(userId: string, blockId: string): Promise<DayPlanDetail> {
    const block = await this.requireOwnBlock(userId, blockId);
    const running = await this.runningSession(userId);
    if (running?.blockId === block.id) {
      await this.endSession(running.id, block.id, running.startedAt, 'paused');
    }
    if (block.status === 'active') {
      await this.db
        .update(planBlocks)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(planBlocks.id, block.id));
    }
    return this.toDetail(await this.requirePlanById(userId, block.planId));
  }

  /**
   * Resolves a block: `done` clears it, `partial` and `skipped` leave it owing
   * work, which is what makes it tomorrow's debt (ADR-015 §4).
   */
  async completeBlock(
    userId: string,
    blockId: string,
    input: CompletePlanBlockInput,
  ): Promise<DayPlanDetail> {
    const block = await this.requireOwnBlock(userId, blockId);
    const plan = await this.requirePlanById(userId, block.planId);
    if (plan.status === 'closed') throw new ConflictException('This day is already closed');
    if (isTerminal(block.status)) throw new ConflictException('This block is already finished');
    if (input.status !== 'done' && !input.reason) {
      throw new BadRequestException('A block that is not done needs a reason');
    }

    const running = await this.runningSession(userId);
    if (running?.blockId === block.id) {
      await this.endSession(running.id, block.id, running.startedAt, 'completed');
    }

    await this.db
      .update(planBlocks)
      .set({
        status: input.status,
        skipReason: input.status === 'done' ? null : (input.reason ?? null),
        outcomeNote: input.note ?? null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(planBlocks.id, block.id));

    return this.toDetail(plan);
  }

  // -------------------------------------------------------------------------
  // Evening close-out (ADR-015 §3)
  // -------------------------------------------------------------------------

  /**
   * Closes the day: anything left unresolved is recorded as `skipped` with the
   * `unreported` reason, the review is stored, and the estimation factor is
   * recomputed from what actually happened.
   */
  async closePlan(
    userId: string,
    planId: string,
    input: CloseDayPlanInput,
    options: { auto?: boolean } = {},
  ): Promise<DayPlanDetail> {
    const plan = await this.requirePlanById(userId, planId);
    if (plan.status === 'closed') throw new ConflictException('This day is already closed');

    const running = await this.runningSession(userId);
    if (running) {
      await this.endSession(running.id, running.blockId, running.startedAt, 'auto');
    }

    const open = (await this.loadBlocks(plan.id)).filter(
      (block) => block.status === 'pending' || block.status === 'active',
    );
    if (open.length > 0) {
      await this.db
        .update(planBlocks)
        .set({
          status: 'skipped',
          skipReason: 'unreported',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          inArray(
            planBlocks.id,
            open.map((block) => block.id),
          ),
        );
    }

    const blocks = await this.loadBlocks(plan.id);
    const review = summarizeDay(blocks.map(toBlockItem), input.note);

    const [closed] = await this.db
      .update(dayPlans)
      .set({
        status: 'closed',
        closedAt: new Date(),
        autoClosed: options.auto ?? false,
        review,
        updatedAt: new Date(),
      })
      .where(eq(dayPlans.id, plan.id))
      .returning();

    await this.recomputeEstimationFactor(userId);
    return this.toDetail(requireRow(closed, 'Plan not found'));
  }

  /**
   * Median actual/estimate over the user's recent timed blocks, stored on the
   * settings row so plan generation and capacity checks can use it directly.
   */
  private async recomputeEstimationFactor(userId: string): Promise<void> {
    const samples = await this.db
      .select({
        estimateMinutes: planBlocks.estimateMinutes,
        actualMinutes: planBlocks.actualMinutes,
        category: planBlocks.category,
      })
      .from(planBlocks)
      .where(
        and(
          eq(planBlocks.userId, userId),
          inArray(planBlocks.status, ['done', 'partial']),
          gt(planBlocks.actualMinutes, 0),
        ),
      )
      .orderBy(desc(planBlocks.completedAt))
      .limit(ESTIMATION_WINDOW * PLAN_BLOCK_CATEGORIES.length);

    const byCategory: Partial<Record<PlanBlockCategory, number>> = {};
    for (const category of PLAN_BLOCK_CATEGORIES) {
      const scoped = samples.filter((sample) => sample.category === category);
      const factor = estimationFactor(scoped);
      // Only record a category once it has earned its own number.
      if (factor !== 1) byCategory[category] = factor;
    }

    await this.db
      .update(plannerSettings)
      .set({
        estimationFactor: estimationFactor(samples.slice(0, ESTIMATION_WINDOW)),
        estimationFactorByCategory: Object.keys(byCategory).length > 0 ? byCategory : null,
        updatedAt: new Date(),
      })
      .where(eq(plannerSettings.userId, userId));
  }

  private async runningSession(userId: string) {
    const [session] = await this.db
      .select()
      .from(focusSessions)
      .where(and(eq(focusSessions.userId, userId), isNull(focusSessions.endedAt)))
      .orderBy(desc(focusSessions.startedAt))
      .limit(1);
    return session;
  }

  /** Closes a session and banks its whole minutes onto the block. */
  private async endSession(
    sessionId: string,
    blockId: string,
    startedAt: Date,
    reason: 'completed' | 'paused' | 'abandoned' | 'auto',
  ): Promise<void> {
    const endedAt = new Date();
    const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
    await this.db
      .update(focusSessions)
      .set({ endedAt, durationSeconds, endedReason: reason })
      .where(eq(focusSessions.id, sessionId));
    const minutes = Math.floor(durationSeconds / 60);
    if (minutes > 0) {
      await this.db
        .update(planBlocks)
        .set({
          actualMinutes: sql`${planBlocks.actualMinutes} + ${minutes}`,
          updatedAt: new Date(),
        })
        .where(eq(planBlocks.id, blockId));
    }
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
    const [blocks, running] = await Promise.all([
      this.loadBlocks(plan.id),
      this.runningSession(plan.userId),
    ]);
    const runningBlock = running
      ? blocks.find((block) => block.id === running.blockId)
      : undefined;
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
      activeSession:
        running && runningBlock
          ? {
              blockId: running.blockId,
              startedAt: running.startedAt.toISOString(),
              bankedMinutes: runningBlock.actualMinutes,
            }
          : null,
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
