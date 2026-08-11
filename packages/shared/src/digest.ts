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

export const DIGEST_DEFAULTS = {
  enabled: true,
  sendTimes: ['09:00'],
  maxItems: DIGEST_MAX_ITEMS_LIMIT,
  minScore: 60,
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
  /** Read-only echo of the timezone the times are resolved in. */
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
