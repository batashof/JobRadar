import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ApplicationCreateInput,
  type ApplicationItem,
  type ApplicationReorderInput,
  type ApplicationStage,
  type ApplicationStats,
  type ApplicationUpdateInput,
  computeFunnel,
  REMINDER_DEFAULT_DAYS,
  REMINDER_STAGES,
} from '@jobradar/shared';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { applications, sources, vacancies } from '../db/schema';

// Stages that imply the application was actually sent (used to stamp applied_at).
const APPLIED_STAGES = ['applied', 'screening', 'tech_interview', 'offer'];
const TERMINAL_STAGES = ['rejected', 'withdrawn'];

/**
 * Advances furthest_stage when moving to a non-terminal stage further along the
 * funnel. Relies on the enum's definition order (saved < … < offer) and on the
 * invariant that furthest_stage itself is never terminal.
 */
function advanceFurthestSql(stage: ApplicationStage): SQL {
  const next = sql`cast(${stage} as application_stage)`;
  return sql`case when ${next} <= 'offer'::application_stage and ${next} > ${applications.furthestStage} then ${next} else ${applications.furthestStage} end`;
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ('code' in e && (e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}

@Injectable()
export class ApplicationsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private readonly selection = {
    id: applications.id,
    stage: applications.stage,
    stageOrder: applications.stageOrder,
    notes: applications.notes,
    appliedAt: applications.appliedAt,
    lastActivityAt: applications.lastActivityAt,
    remindAfterDays: applications.remindAfterDays,
    createdAt: applications.createdAt,
    vacancyId: vacancies.id,
    vacancyTitle: vacancies.title,
    vacancyCompany: vacancies.companyRaw,
    vacancyUrl: vacancies.url,
    vacancySource: sources.slug,
  };

  private async selectItems(where: SQL | undefined): Promise<ApplicationItem[]> {
    const rows = await this.db
      .select(this.selection)
      .from(applications)
      .innerJoin(vacancies, eq(vacancies.id, applications.vacancyId))
      .innerJoin(sources, eq(sources.id, vacancies.sourceId))
      .where(where)
      .orderBy(asc(applications.stageOrder));

    return rows.map((r) => ({
      id: r.id,
      stage: r.stage,
      stageOrder: r.stageOrder,
      notes: r.notes,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      lastActivityAt: r.lastActivityAt.toISOString(),
      remindAfterDays: r.remindAfterDays,
      createdAt: r.createdAt.toISOString(),
      vacancy: {
        id: r.vacancyId,
        title: r.vacancyTitle,
        company: r.vacancyCompany,
        url: r.vacancyUrl,
        source: r.vacancySource,
      },
    }));
  }

  list(userId: string): Promise<ApplicationItem[]> {
    return this.selectItems(eq(applications.userId, userId));
  }

  /**
   * Applications waiting for an answer past their reminder threshold
   * (per-application `remind_after_days` or the shared default), oldest first.
   */
  async listReminders(userId: string): Promise<ApplicationItem[]> {
    const items = await this.selectItems(
      and(
        eq(applications.userId, userId),
        inArray(applications.stage, [...REMINDER_STAGES]),
        sql`${applications.lastActivityAt} <= now() - make_interval(days => coalesce(${applications.remindAfterDays}, ${REMINDER_DEFAULT_DAYS}))`,
      ),
    );
    return items.sort(
      (a, b) => new Date(a.lastActivityAt).getTime() - new Date(b.lastActivityAt).getTime(),
    );
  }

  /** Board totals + funnel conversion built from furthest-reached stages. */
  async stats(userId: string): Promise<ApplicationStats> {
    const [byStageRows, byFurthestRows] = await Promise.all([
      this.db
        .select({ stage: applications.stage, count: sql<number>`count(*)::int` })
        .from(applications)
        .where(eq(applications.userId, userId))
        .groupBy(applications.stage),
      this.db
        .select({ stage: applications.furthestStage, count: sql<number>`count(*)::int` })
        .from(applications)
        .where(eq(applications.userId, userId))
        .groupBy(applications.furthestStage),
    ]);

    const byStage: ApplicationStats['byStage'] = {};
    let total = 0;
    for (const row of byStageRows) {
      byStage[row.stage] = row.count;
      total += row.count;
    }
    const furthestCounts: Partial<Record<ApplicationStage, number>> = {};
    for (const row of byFurthestRows) furthestCounts[row.stage] = row.count;

    return { total, byStage, funnel: computeFunnel(furthestCounts) };
  }

  async create(userId: string, input: ApplicationCreateInput): Promise<ApplicationItem> {
    const stage: ApplicationStage = input.stage ?? 'saved';
    // Append to the end of its column.
    const orderRows = await this.db
      .select({
        nextOrder: sql<number>`coalesce(max(${applications.stageOrder}), -1) + 1`,
      })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.stage, stage)));
    const nextOrder = orderRows[0]?.nextOrder ?? 0;

    let id: string;
    try {
      const [row] = await this.db
        .insert(applications)
        .values({
          userId,
          vacancyId: input.vacancyId,
          stage,
          furthestStage: TERMINAL_STAGES.includes(stage) ? 'saved' : stage,
          stageOrder: nextOrder ?? 0,
          appliedAt: APPLIED_STAGES.includes(stage) ? new Date() : null,
        })
        .returning({ id: applications.id });
      if (!row) throw new Error('Application insert returned no row');
      id = row.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('This vacancy is already on your board');
      }
      throw err;
    }

    const [item] = await this.selectItems(
      and(eq(applications.userId, userId), eq(applications.id, id)),
    );
    if (!item) throw new Error('Application not found after insert');
    return item;
  }

  async update(
    userId: string,
    id: string,
    input: ApplicationUpdateInput,
  ): Promise<ApplicationItem> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.notes !== undefined) set.notes = input.notes;
    if (input.remindAfterDays !== undefined) set.remindAfterDays = input.remindAfterDays;
    if (input.stage !== undefined) {
      set.stage = input.stage;
      set.furthestStage = advanceFurthestSql(input.stage);
      set.lastActivityAt = new Date();
      if (APPLIED_STAGES.includes(input.stage)) {
        set.appliedAt = sql`coalesce(${applications.appliedAt}, now())`;
      }
    }

    const [row] = await this.db
      .update(applications)
      .set(set)
      .where(and(eq(applications.id, id), eq(applications.userId, userId)))
      .returning({ id: applications.id });
    if (!row) throw new NotFoundException('Application not found');

    const [item] = await this.selectItems(
      and(eq(applications.userId, userId), eq(applications.id, id)),
    );
    if (!item) throw new NotFoundException('Application not found');
    return item;
  }

  async remove(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .delete(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, userId)))
      .returning({ id: applications.id });
    if (!row) throw new NotFoundException('Application not found');
  }

  /** Applies a new stage + order to the given columns, scoped to the user's own cards. */
  async reorder(userId: string, input: ApplicationReorderInput): Promise<ApplicationItem[]> {
    await this.db.transaction(async (tx) => {
      for (const column of input.columns) {
        const applied = APPLIED_STAGES.includes(column.stage);
        for (const [i, cardId] of column.orderedIds.entries()) {
          await tx
            .update(applications)
            .set({
              stage: column.stage,
              furthestStage: advanceFurthestSql(column.stage),
              stageOrder: i,
              lastActivityAt: new Date(),
              updatedAt: new Date(),
              ...(applied
                ? { appliedAt: sql`coalesce(${applications.appliedAt}, now())` }
                : {}),
            })
            .where(and(eq(applications.id, cardId), eq(applications.userId, userId)));
        }
      }
    });

    const allIds = input.columns.flatMap((c) => c.orderedIds);
    if (allIds.length === 0) return [];
    return this.selectItems(
      and(eq(applications.userId, userId), inArray(applications.id, allIds)),
    );
  }
}
