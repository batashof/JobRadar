import { z } from 'zod';

/**
 * Daily vacancy digest — the resume-matched shortlist pushed to Telegram.
 *
 * This file is the configuration half: when to send, how many times a day, how
 * many vacancies per send, and how good a match has to be to make the cut. The
 * sending itself (candidate funnel, LLM scoring, message rendering) lands next
 * and reads exactly these settings.
 *
 * Times are wall-clock in the user's timezone, which is per-user state that
 * currently lives in `planner_settings.timezone` (ADR-015 §7 made it real).
 * The digest reads it rather than keeping a second copy that could drift.
 */

/** A digest is a shortlist, not a feed dump — ten is the hard ceiling. */
export const DIGEST_MAX_ITEMS_LIMIT = 10;

/** More than a handful of pushes a day stops being a digest and becomes noise. */
export const DIGEST_MAX_SENDS_PER_DAY = 4;

/**
 * How the digest is delivered (ADR-019). `scheduled` pushes a ranked shortlist
 * at the send times; `instant` pushes new matches as soon as an ingestion run
 * brings them in, outside quiet hours, and ignores the send times.
 */
export const DIGEST_MODES = ['scheduled', 'instant'] as const;
export type DigestMode = (typeof DIGEST_MODES)[number];

export const DIGEST_DEFAULTS = {
  enabled: true,
  mode: 'scheduled' as DigestMode,
  sendTimes: ['09:00'],
  maxItems: DIGEST_MAX_ITEMS_LIMIT,
  minScore: 60,
  quietStart: '22:00',
  quietEnd: '08:00',
  instantMinScore: 75,
} as const;

export interface DigestSettings {
  /** Off = nothing is sent; the settings are kept. */
  enabled: boolean;
  /** `HH:MM` local to `timezone`, sorted and unique, 1..DIGEST_MAX_SENDS_PER_DAY. */
  sendTimes: string[];
  /** Cap per send, 1..DIGEST_MAX_ITEMS_LIMIT. Fewer is fine; padding is not. */
  maxItems: number;
  /** Resume-fit floor in percent — below it a vacancy is not worth a push. */
  minScore: number;
  /** `scheduled` = at the send times; `instant` = as new matches arrive (ADR-019). */
  mode: DigestMode;
  /**
   * Instant mode stays silent from `quietStart` to `quietEnd` (local `HH:MM`,
   * may wrap midnight; equal = never quiet) and catches up when it ends.
   */
  quietStart: string;
  quietEnd: string;
  /**
   * Instant mode's floor. Stricter than `minScore`: a scheduled digest weighs a
   * day's vacancies against each other, an instant push judges a few on their
   * own and interrupts every time.
   */
  instantMinScore: number;
  /** The timezone the times are resolved in; shared with the planner. */
  timezone: string;
}

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

export const updateDigestSettingsSchema = z
  .object({
    enabled: z.boolean(),
    sendTimes: z
      .array(timeOfDay)
      .min(1)
      .max(DIGEST_MAX_SENDS_PER_DAY)
      // Two pushes at the same minute would race for the same vacancies.
      .refine((times) => new Set(times).size === times.length, 'Send times must be unique'),
    maxItems: z.number().int().min(1).max(DIGEST_MAX_ITEMS_LIMIT),
    minScore: z.number().int().min(0).max(100),
    mode: z.enum(DIGEST_MODES),
    quietStart: timeOfDay,
    quietEnd: timeOfDay,
    instantMinScore: z.number().int().min(0).max(100),
    /**
     * The zone the send times were entered in. Stored on `planner_settings`,
     * not here — there is one timezone per user, and a second copy would let
     * the digest and the planner disagree about what "09:00" means.
     */
    timezone: z.string().trim().min(1).max(64),
  })
  .partial();
export type UpdateDigestSettingsInput = z.infer<typeof updateDigestSettingsSchema>;

/** Stored order is not the caller's problem: the API sorts before saving. */
export function sortSendTimes(times: string[]): string[] {
  return [...times].sort();
}

/** POST /digest/run — how many vacancies the manual send pushed. */
export interface DigestRunResponse {
  sent: number;
}
