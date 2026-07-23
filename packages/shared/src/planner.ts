import { z } from 'zod';

/**
 * Day planner (ADR-015): an ordered queue of timeboxes for one day, not a
 * calendar. Increment 1 covers the schema, the SQL-collected candidates and a
 * manually assembled plan with the morning "accept" ritual. The focus timer,
 * evening close-out, rolling debt bookkeeping, LLM composition and Telegram
 * nudges land in later increments — their enum values are defined here so the
 * stored shape never has to change.
 */

export const PLAN_BLOCK_CATEGORIES = [
  'job_search',
  'interview_prep',
  'learning',
  'admin',
  'other',
] as const;
export type PlanBlockCategory = (typeof PLAN_BLOCK_CATEGORIES)[number];

/** Where a block came from. `manual` = typed by the user, the rest are candidates. */
export const PLAN_BLOCK_SOURCE_KINDS = [
  'manual',
  'application_followup',
  'interview_topic',
  'vacancy_apply',
  'course',
  'debt',
] as const;
export type PlanBlockSourceKind = (typeof PLAN_BLOCK_SOURCE_KINDS)[number];

export const PLAN_BLOCK_STATUSES = [
  'pending',
  'active',
  'done',
  'partial',
  'skipped',
  'dropped',
] as const;
export type PlanBlockStatus = (typeof PLAN_BLOCK_STATUSES)[number];

/** Statuses that still owe work — they become debt at day close. */
export const PLAN_BLOCK_UNFINISHED_STATUSES = [
  'pending',
  'active',
  'partial',
  'skipped',
] as const satisfies readonly PlanBlockStatus[];

export const PLAN_SKIP_REASONS = [
  'no_time',
  'no_energy',
  'blocked',
  'changed_priority',
  'avoided',
  /** Written by the tick job when a day is auto-closed without a review. */
  'unreported',
] as const;
export type PlanSkipReason = (typeof PLAN_SKIP_REASONS)[number];

export const DAY_PLAN_STATUSES = ['draft', 'accepted', 'closed'] as const;
export type DayPlanStatus = (typeof DAY_PLAN_STATUSES)[number];

/** `fallback` = deterministic ordering used when the LLM gateway is unavailable. */
export const DAY_PLAN_GENERATORS = ['manual', 'llm', 'fallback'] as const;
export type DayPlanGenerator = (typeof DAY_PLAN_GENERATORS)[number];

/** `carry_count` at which a block is treated as rotting: pinned first, escalated. */
export const PLAN_ROTTING_CARRY_COUNT = 3;

export const PLANNER_DEFAULTS = {
  timezone: 'UTC',
  morningRitualAt: '09:00',
  eveningReviewAt: '20:00',
  capacityMinutes: 240,
  defaultBlockMinutes: 30,
  escalationAfterMinutes: 20,
  escalationMaxRepeats: 2,
  estimationFactor: 1,
} as const;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface PlannerSettings {
  /** IANA timezone; defines what "today" and the ritual times mean. */
  timezone: string;
  /** `HH:MM`, local to `timezone`. */
  morningRitualAt: string;
  eveningReviewAt: string;
  capacityMinutes: number;
  defaultBlockMinutes: number;
  /** Soft weekly minutes per category; null = no targets set. */
  categoryTargets: Partial<Record<PlanBlockCategory, number>> | null;
  telegramChatId: string | null;
  telegramEnabled: boolean;
  escalationAfterMinutes: number;
  escalationMaxRepeats: number;
  /** Cached median actual/estimate; 1 until enough blocks have been timed. */
  estimationFactor: number;
  estimationFactorByCategory: Partial<Record<PlanBlockCategory, number>> | null;
}

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

export const updatePlannerSettingsSchema = z
  .object({
    timezone: z.string().trim().min(1).max(64),
    morningRitualAt: timeOfDay,
    eveningReviewAt: timeOfDay,
    capacityMinutes: z.number().int().min(15).max(960),
    defaultBlockMinutes: z.number().int().min(5).max(240),
    categoryTargets: z
      .record(z.enum(PLAN_BLOCK_CATEGORIES), z.number().int().min(0).max(10_080))
      .nullable(),
    telegramChatId: z.string().trim().max(64).nullable(),
    telegramEnabled: z.boolean(),
    escalationAfterMinutes: z.number().int().min(5).max(240),
    escalationMaxRepeats: z.number().int().min(0).max(5),
  })
  .partial();
export type UpdatePlannerSettingsInput = z.infer<typeof updatePlannerSettingsSchema>;

// ---------------------------------------------------------------------------
// Plan + blocks
// ---------------------------------------------------------------------------

/** Backlink from a block to the app object it came from. */
export interface PlanBlockSourceRef {
  applicationId?: string;
  vacancyId?: string;
  interviewPlanId?: string;
  topicKey?: string;
}

export interface PlanBlockItem {
  id: string;
  position: number;
  title: string;
  details: string | null;
  category: PlanBlockCategory;
  sourceKind: PlanBlockSourceKind;
  sourceRef: PlanBlockSourceRef | null;
  estimateMinutes: number;
  /** `estimateMinutes` × the estimation factor at insert time; capacity uses this. */
  correctedEstimateMinutes: number;
  actualMinutes: number;
  status: PlanBlockStatus;
  skipReason: PlanSkipReason | null;
  outcomeNote: string | null;
  carriedFromBlockId: string | null;
  carryCount: number;
  startedAt: string | null;
  completedAt: string | null;
}

/** Close-out summary, written when the day is closed (increment 2). */
export interface DayPlanReview {
  completedBlocks: number;
  totalBlocks: number;
  plannedMinutes: number;
  actualMinutes: number;
  minutesByCategory: Partial<Record<PlanBlockCategory, number>>;
  /** Blocks pushed into debt by this close. */
  debtCreated: number;
  note?: string;
}

export interface DayPlanDetail {
  id: string;
  /** `YYYY-MM-DD` in the user's timezone. */
  planDate: string;
  status: DayPlanStatus;
  generatedBy: DayPlanGenerator;
  intent: string | null;
  acceptedAt: string | null;
  closedAt: string | null;
  autoClosed: boolean;
  review: DayPlanReview | null;
  blocks: PlanBlockItem[];
}

/** GET /planner/today — the plan plus everything the day surface needs. */
export interface PlannerTodayResponse {
  /** `YYYY-MM-DD` resolved in the user's timezone. */
  today: string;
  plan: DayPlanDetail | null;
  settings: PlannerSettings;
}

/** POST /planner/plans — start today's plan (idempotent per day). */
export const createDayPlanSchema = z.object({
  intent: z.string().trim().max(200).optional(),
});
export type CreateDayPlanInput = z.infer<typeof createDayPlanSchema>;

/** POST /planner/blocks — add a block to today's plan. */
export const addPlanBlockSchema = z.object({
  title: z.string().trim().min(1).max(200),
  details: z.string().trim().max(2000).optional(),
  category: z.enum(PLAN_BLOCK_CATEGORIES),
  sourceKind: z.enum(PLAN_BLOCK_SOURCE_KINDS).optional(),
  sourceRef: z
    .object({
      applicationId: z.string().uuid().optional(),
      vacancyId: z.string().uuid().optional(),
      interviewPlanId: z.string().uuid().optional(),
      topicKey: z.string().trim().max(200).optional(),
    })
    .optional(),
  estimateMinutes: z.number().int().min(5).max(480).optional(),
  /** Set when the block is carried over from an unfinished one (debt). */
  carriedFromBlockId: z.string().uuid().optional(),
});
export type AddPlanBlockInput = z.infer<typeof addPlanBlockSchema>;

/** PATCH /planner/blocks/:id — edit a block before (or during) the day. */
export const updatePlanBlockSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    details: z.string().trim().max(2000).nullable(),
    category: z.enum(PLAN_BLOCK_CATEGORIES),
    estimateMinutes: z.number().int().min(5).max(480),
  })
  .partial();
export type UpdatePlanBlockInput = z.infer<typeof updatePlanBlockSchema>;

/** POST /planner/plans/:id/reorder — the queue order, as a full id list. */
export const reorderPlanBlocksSchema = z.object({
  blockIds: z.array(z.string().uuid()).min(1).max(50),
});
export type ReorderPlanBlocksInput = z.infer<typeof reorderPlanBlocksSchema>;

/** DELETE /planner/blocks/:id — dropping is deliberate and recorded (ADR-015). */
export const dropPlanBlockSchema = z.object({
  reason: z.enum(PLAN_SKIP_REASONS).optional(),
});
export type DropPlanBlockInput = z.infer<typeof dropPlanBlockSchema>;

// ---------------------------------------------------------------------------
// Candidates (collected with plain SQL — no LLM, ADR-015 §2)
// ---------------------------------------------------------------------------

export interface PlanCandidate {
  /** Stable within a collection run; `${sourceKind}:${entity id}`. */
  key: string;
  sourceKind: PlanBlockSourceKind;
  category: PlanBlockCategory;
  /** Already localised to the user's language (ADR-014). */
  title: string;
  /** One line on why this is on the list today. */
  reason: string;
  sourceRef: PlanBlockSourceRef | null;
  estimateMinutes: number;
  /** Debt only: how many days this has been carried. */
  carryCount?: number;
  carriedFromBlockId?: string;
}

export interface PlanCandidatesResponse {
  candidates: PlanCandidate[];
  /** Unfinished blocks left behind on earlier days (count + corrected minutes). */
  debt: { count: number; minutes: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Applies the user's personal estimation factor, so a plan is checked against
 * how long things actually take rather than how long they were planned to take.
 */
export function correctEstimate(estimateMinutes: number, factor: number): number {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return Math.max(1, Math.round(estimateMinutes * safeFactor));
}

/** Corrected minutes already committed for a day (dropped blocks do not count). */
export function plannedMinutes(blocks: Pick<PlanBlockItem, 'status' | 'correctedEstimateMinutes'>[]): number {
  return blocks
    .filter((block) => block.status !== 'dropped')
    .reduce((total, block) => total + block.correctedEstimateMinutes, 0);
}

export function isRotting(block: Pick<PlanBlockItem, 'carryCount'>): boolean {
  return block.carryCount >= PLAN_ROTTING_CARRY_COUNT;
}

/**
 * `YYYY-MM-DD` for the given instant in an IANA timezone. `en-CA` formats dates
 * as ISO, which keeps this dependency-free (ADR-001).
 */
export function localDayKey(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}
