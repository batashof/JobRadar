import {
  daysSinceActivity,
  isReminderDue,
  REMINDER_DEFAULT_DAYS,
  reminderThresholdDays,
  type ReminderInput,
} from '@jobradar/shared';

const NOW = new Date('2026-07-20T12:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function input(overrides: Partial<ReminderInput> = {}): ReminderInput {
  return {
    stage: 'applied',
    lastActivityAt: daysAgo(10),
    remindAfterDays: null,
    ...overrides,
  };
}

describe('reminder logic', () => {
  it('uses the shared default when no per-application override is set', () => {
    expect(reminderThresholdDays({ remindAfterDays: null })).toBe(REMINDER_DEFAULT_DAYS);
    expect(reminderThresholdDays({ remindAfterDays: 14 })).toBe(14);
  });

  it('counts whole days since the last activity', () => {
    expect(daysSinceActivity({ lastActivityAt: daysAgo(10) }, NOW)).toBe(10);
    expect(daysSinceActivity({ lastActivityAt: daysAgo(0.5) }, NOW)).toBe(0);
    // A clock skewed into the future must not produce negative days.
    expect(daysSinceActivity({ lastActivityAt: daysAgo(-1) }, NOW)).toBe(0);
  });

  it('is due when a waiting stage is past the threshold', () => {
    expect(isReminderDue(input(), NOW)).toBe(true);
    expect(isReminderDue(input({ stage: 'screening' }), NOW)).toBe(true);
    expect(isReminderDue(input({ stage: 'tech_interview' }), NOW)).toBe(true);
  });

  it('is not due before the threshold', () => {
    expect(isReminderDue(input({ lastActivityAt: daysAgo(6) }), NOW)).toBe(false);
    expect(isReminderDue(input({ lastActivityAt: daysAgo(7) }), NOW)).toBe(true);
  });

  it('honors the per-application override', () => {
    expect(isReminderDue(input({ remindAfterDays: 14 }), NOW)).toBe(false);
    expect(isReminderDue(input({ lastActivityAt: daysAgo(3), remindAfterDays: 3 }), NOW)).toBe(
      true,
    );
  });

  it('never fires for stages that are not waiting for an answer', () => {
    for (const stage of ['saved', 'offer', 'rejected', 'withdrawn'] as const) {
      expect(isReminderDue(input({ stage, lastActivityAt: daysAgo(100) }), NOW)).toBe(false);
    }
  });
});
