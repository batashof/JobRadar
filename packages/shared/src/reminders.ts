import type { ApplicationStage } from './applications';

/**
 * Follow-up reminders ("no answer for N days"), delivered in-app.
 * An application is due when it sits in a waiting stage with no activity for
 * `remind_after_days` (per-application override) or the default below.
 */

export const REMINDER_DEFAULT_DAYS = 7;

/** Stages where the user is waiting for the company to respond. */
export const REMINDER_STAGES = ['applied', 'screening', 'tech_interview'] as const satisfies
  readonly ApplicationStage[];

export interface ReminderInput {
  stage: ApplicationStage;
  /** ISO timestamp of the last stage change. */
  lastActivityAt: string;
  remindAfterDays: number | null;
}

export function reminderThresholdDays(item: Pick<ReminderInput, 'remindAfterDays'>): number {
  return item.remindAfterDays ?? REMINDER_DEFAULT_DAYS;
}

export function daysSinceActivity(item: Pick<ReminderInput, 'lastActivityAt'>, now: Date): number {
  const elapsed = now.getTime() - new Date(item.lastActivityAt).getTime();
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

export function isReminderDue(item: ReminderInput, now: Date): boolean {
  return (
    (REMINDER_STAGES as readonly ApplicationStage[]).includes(item.stage) &&
    daysSinceActivity(item, now) >= reminderThresholdDays(item)
  );
}
