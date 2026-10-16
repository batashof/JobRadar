import {
  type ApplicationStage,
  isReminderDue,
  type Language,
  reminderThresholdDays,
} from '@jobradar/shared';

import { localMinutesOfDay } from '../planner/tick-logic';

/**
 * The decision half of the follow-up reminder sweep (roadmap 5.5): which
 * waiting applications get a "no answer for N days" message right now. Pure,
 * so the rules are pinned by tests rather than by a clock; the IO half lives in
 * `application-reminders.service.ts`.
 */

/** Reminders go out only between these local hours: never at night. */
export const REMINDER_LOCAL_START_MINUTES = 10 * 60;
export const REMINDER_LOCAL_END_MINUTES = 20 * 60;

/** A waiting application whose owner has a linked chat, as the sweep loads it. */
export interface ReminderCandidate {
  id: string;
  userId: string;
  stage: ApplicationStage;
  lastActivityAt: Date;
  remindAfterDays: number | null;
  /** When the last reminder for it went out; null if none ever did. */
  remindedAt: Date | null;
  title: string;
  company: string;
  /** `planner_settings.timezone`; null for an account without that row. */
  timezone: string | null;
  language: Language;
}

/**
 * Whether `now` falls inside the reminder window in `timezone`. An unknown
 * timezone falls back to UTC rather than silencing the user for good.
 */
export function isReminderHour(now: Date, timezone: string | null): boolean {
  let minutes: number;
  try {
    minutes = localMinutesOfDay(now, timezone ?? 'UTC');
  } catch {
    minutes = localMinutesOfDay(now, 'UTC');
  }
  return minutes >= REMINDER_LOCAL_START_MINUTES && minutes < REMINDER_LOCAL_END_MINUTES;
}

/**
 * One application's verdict: due when it waits in a reminder stage past its
 * threshold, has not been reminded since its last activity, and it is daytime
 * where its owner lives. "Since its last activity" is what makes a reminder
 * fire once per quiet spell: a stage change or "remind later" moves
 * `last_activity_at` past `reminded_at` and re-arms it.
 */
export function isReminderToSend(candidate: ReminderCandidate, now: Date): boolean {
  const waiting = isReminderDue(
    {
      stage: candidate.stage,
      lastActivityAt: candidate.lastActivityAt.toISOString(),
      remindAfterDays: candidate.remindAfterDays,
    },
    now,
  );
  if (!waiting) return false;
  if (candidate.remindedAt && candidate.remindedAt >= candidate.lastActivityAt) return false;
  return isReminderHour(now, candidate.timezone);
}

/** The candidates to remind right now, oldest silence first. */
export function dueReminders(candidates: ReminderCandidate[], now: Date): ReminderCandidate[] {
  return candidates
    .filter((candidate) => isReminderToSend(candidate, now))
    .sort((a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime());
}

/** Days the snooze button promises: the application's own threshold. */
export function snoozeDays(candidate: Pick<ReminderCandidate, 'remindAfterDays'>): number {
  return reminderThresholdDays(candidate);
}
