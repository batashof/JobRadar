import { Inject, Injectable, Logger } from '@nestjs/common';
import { localDayKey, type PlanBlockItem } from '@jobradar/shared';
import { and, asc, eq, inArray, isNull, lt, ne } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { dayPlans, focusSessions, planBlocks, plannerNudges, plannerSettings } from '../db/schema';
import { PlannerService } from './planner.service';
import {
  decideNudges,
  escalationAction,
  localMinutesOfDay,
  type PlannedNudge,
  type TickPlanState,
} from './tick-logic';

export interface TickResult {
  users: number;
  autoClosed: number;
  raised: number;
  escalated: number;
  ignored: number;
}

/**
 * The IO half of `planner:tick` (ADR-015 §7). Runs every minute inside the API
 * — not via GitHub Actions, whose free minutes cannot cover minute granularity
 * on a private repo, and whose keep-alive already keeps this process warm.
 *
 * Everything here is idempotent: a nudge is raised at most once per day (or per
 * block) and claimed before it is delivered, so a restart delays a poke but
 * never duplicates it. Delivery is in-app for now; the Telegram channel plugs
 * into the same rows once a bot token exists.
 */
@Injectable()
export class PlannerTickService {
  private readonly logger = new Logger(PlannerTickService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly planner: PlannerService,
  ) {}

  async run(now = new Date()): Promise<TickResult> {
    const users = await this.db.select().from(plannerSettings);
    const result: TickResult = { users: users.length, autoClosed: 0, raised: 0, escalated: 0, ignored: 0 };

    for (const settings of users) {
      try {
        const today = localDayKey(now, settings.timezone);
        result.autoClosed += await this.autoCloseStaleDays(settings.userId, today);
        result.raised += await this.raiseNudges(settings, today, now);
        const escalation = await this.escalate(settings, now);
        result.escalated += escalation.escalated;
        result.ignored += escalation.ignored;
      } catch (err) {
        // One user's bad state must never stop the tick for everyone else.
        this.logger.error(
          `planner:tick failed for user ${settings.userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return result;
  }

  /**
   * A day nobody closed is closed by the tick, with everything unresolved
   * marked `unreported` — the worst-looking outcome in the stats, on purpose
   * (ADR-015 §3). This is what turns yesterday's leftovers into today's debt.
   */
  private async autoCloseStaleDays(userId: string, today: string): Promise<number> {
    const stale = await this.db
      .select({ id: dayPlans.id })
      .from(dayPlans)
      .where(
        and(eq(dayPlans.userId, userId), lt(dayPlans.planDate, today), ne(dayPlans.status, 'closed')),
      );

    for (const plan of stale) {
      await this.planner.closePlan(userId, plan.id, {}, { auto: true });
    }
    return stale.length;
  }

  private async raiseNudges(
    settings: typeof plannerSettings.$inferSelect,
    today: string,
    now: Date,
  ): Promise<number> {
    const [plan] = await this.db
      .select()
      .from(dayPlans)
      .where(and(eq(dayPlans.userId, settings.userId), eq(dayPlans.planDate, today)));

    const blocks = plan
      ? await this.db
          .select()
          .from(planBlocks)
          .where(eq(planBlocks.planId, plan.id))
          .orderBy(asc(planBlocks.position))
      : [];

    const [running] = await this.db
      .select()
      .from(focusSessions)
      .where(and(eq(focusSessions.userId, settings.userId), isNull(focusSessions.endedAt)))
      .limit(1);
    const runningBlock = running ? blocks.find((block) => block.id === running.blockId) : undefined;

    const state: TickPlanState = {
      localMinutes: localMinutesOfDay(now, settings.timezone),
      morningRitualAt: settings.morningRitualAt,
      eveningReviewAt: settings.eveningReviewAt,
      plan: plan ? { id: plan.id, status: plan.status } : null,
      blocks: blocks.map(
        (block): Pick<PlanBlockItem, 'id' | 'status' | 'correctedEstimateMinutes' | 'actualMinutes'> => ({
          id: block.id,
          status: block.status,
          correctedEstimateMinutes: block.correctedEstimateMinutes,
          actualMinutes: block.actualMinutes,
        }),
      ),
      activeSession:
        running && runningBlock
          ? {
              blockId: running.blockId,
              startedAt: running.startedAt.toISOString(),
              bankedMinutes: runningBlock.actualMinutes,
            }
          : null,
      debtCount: await this.debtCount(settings.userId, today),
      raised: await this.raisedToday(settings.userId, today),
    };

    const due = decideNudges(state, now);
    for (const nudge of due) {
      await this.insertNudge(settings.userId, plan?.id ?? null, nudge, now);
    }
    return due.length;
  }

  /** In-app delivery is immediate: the row is written already `sent`. */
  private async insertNudge(
    userId: string,
    planId: string | null,
    nudge: PlannedNudge,
    now: Date,
  ): Promise<void> {
    await this.db.insert(plannerNudges).values({
      userId,
      planId,
      blockId: nudge.blockId ?? null,
      kind: nudge.kind,
      channel: 'in_app',
      scheduledFor: now,
      status: 'sent',
      sentAt: now,
    });
  }

  /** Nudge keys already raised for today, so nothing is raised twice. */
  private async raisedToday(userId: string, today: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ kind: plannerNudges.kind, blockId: plannerNudges.blockId, planId: plannerNudges.planId })
      .from(plannerNudges)
      .leftJoin(dayPlans, eq(plannerNudges.planId, dayPlans.id))
      .where(eq(plannerNudges.userId, userId));

    const keys = new Set<string>();
    for (const row of rows) {
      keys.add(row.blockId ? `${row.kind}:${row.blockId}` : row.kind);
    }
    // Kinds without a block are day-scoped: keep only today's plan's rows.
    const todaysPlan = await this.db
      .select({ id: dayPlans.id })
      .from(dayPlans)
      .where(and(eq(dayPlans.userId, userId), eq(dayPlans.planDate, today)));
    const todayPlanId = todaysPlan[0]?.id ?? null;
    for (const row of rows) {
      if (!row.blockId && row.planId !== todayPlanId) keys.delete(row.kind);
    }
    return keys;
  }

  private async debtCount(userId: string, today: string): Promise<number> {
    const rows = await this.db
      .select({ id: planBlocks.id })
      .from(planBlocks)
      .innerJoin(dayPlans, eq(planBlocks.planId, dayPlans.id))
      .where(
        and(
          eq(planBlocks.userId, userId),
          lt(dayPlans.planDate, today),
          inArray(planBlocks.status, ['pending', 'active', 'partial', 'skipped']),
        ),
      );
    return rows.length;
  }

  /**
   * Escalation is bounded (ADR-015 §6): repeat at most `escalationMaxRepeats`
   * times, then record the nudge as ignored. The point is a visible record of
   * ignoring, not an alarm that cannot be muted.
   */
  private async escalate(
    settings: typeof plannerSettings.$inferSelect,
    now: Date,
  ): Promise<{ escalated: number; ignored: number }> {
    const open = await this.db
      .select()
      .from(plannerNudges)
      .where(and(eq(plannerNudges.userId, settings.userId), eq(plannerNudges.status, 'sent')));

    let escalated = 0;
    let ignored = 0;
    for (const nudge of open) {
      const action = escalationAction(nudge, now, settings);
      if (action === 'wait') continue;
      if (action === 'repeat') {
        await this.db
          .update(plannerNudges)
          .set({ repeatIndex: nudge.repeatIndex + 1, sentAt: now })
          .where(eq(plannerNudges.id, nudge.id));
        escalated += 1;
      } else {
        await this.db
          .update(plannerNudges)
          .set({ status: 'ignored' })
          .where(eq(plannerNudges.id, nudge.id));
        ignored += 1;
      }
    }
    return { escalated, ignored };
  }
}
