import { z } from 'zod';

/**
 * Application-tracker (kanban) contracts. Stage tuple mirrors the
 * `application_stage` Postgres enum in apps/api/src/db/schema.ts.
 */

export const APPLICATION_STAGES = [
  'saved',
  'applied',
  'screening',
  'tech_interview',
  'offer',
  'rejected',
  'withdrawn',
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const applicationCreateSchema = z.object({
  vacancyId: z.uuid(),
  stage: z.enum(APPLICATION_STAGES).optional(),
});

export const applicationUpdateSchema = z
  .object({
    stage: z.enum(APPLICATION_STAGES),
    notes: z.string().max(5000),
    remindAfterDays: z.number().int().min(1).max(365).nullable(),
  })
  .partial();

/** Batch reorder: each affected column with its cards in their new order. */
export const applicationReorderSchema = z.object({
  columns: z
    .array(
      z.object({
        stage: z.enum(APPLICATION_STAGES),
        orderedIds: z.array(z.uuid()),
      }),
    )
    .min(1),
});

export type ApplicationCreateInput = z.infer<typeof applicationCreateSchema>;
export type ApplicationUpdateInput = z.infer<typeof applicationUpdateSchema>;
export type ApplicationReorderInput = z.infer<typeof applicationReorderSchema>;

/** The vacancy summary embedded in a board card. */
export interface ApplicationVacancy {
  id: string;
  title: string;
  company: string;
  url: string;
  source: string;
}

/** An application as serialized for the board (timestamps ISO). */
export interface ApplicationItem {
  id: string;
  stage: ApplicationStage;
  stageOrder: number;
  notes: string;
  appliedAt: string | null;
  lastActivityAt: string;
  remindAfterDays: number | null;
  createdAt: string;
  vacancy: ApplicationVacancy;
}

/** Funnel steps in order (phase 4 stats): applied → screening → tech → offer. */
export const FUNNEL_STAGES = ['applied', 'screening', 'tech_interview', 'offer'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface FunnelStep {
  stage: FunnelStage;
  /** Applications whose furthest reached stage is this one or later. */
  reached: number;
  /** reached / previous step's reached; null for the first step and on 0/0. */
  conversion: number | null;
}

/** GET /applications/stats */
export interface ApplicationStats {
  total: number;
  /** Current column sizes on the board. */
  byStage: Partial<Record<ApplicationStage, number>>;
  funnel: FunnelStep[];
}

/**
 * Builds the funnel from "furthest stage reached" counts. `furthestCounts`
 * holds non-terminal stages only (the tracker never stores a terminal stage as
 * furthest), so a card rejected after screening still counts through screening.
 */
export function computeFunnel(
  furthestCounts: Partial<Record<ApplicationStage, number>>,
): FunnelStep[] {
  const order: ApplicationStage[] = ['saved', ...FUNNEL_STAGES];
  const rank = (stage: ApplicationStage): number => order.indexOf(stage);

  const steps: FunnelStep[] = [];
  let previous: number | null = null;
  for (const stage of FUNNEL_STAGES) {
    const reached = Object.entries(furthestCounts).reduce(
      (sum, [s, count]) =>
        rank(s as ApplicationStage) >= rank(stage) ? sum + (count ?? 0) : sum,
      0,
    );
    const conversion = previous == null || previous === 0 ? null : reached / previous;
    steps.push({ stage, reached, conversion });
    previous = reached;
  }
  return steps;
}
