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
