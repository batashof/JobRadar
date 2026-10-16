import {
  dueReminders,
  isReminderHour,
  isReminderToSend,
  type ReminderCandidate,
  snoozeDays,
} from './reminder-logic';

// 12:00 UTC = 15:00 in Moscow, 08:00 in New York.
const NOW = new Date('2026-10-16T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function candidate(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: 'app-1',
    userId: 'user-1',
    stage: 'applied',
    lastActivityAt: daysAgo(8),
    remindAfterDays: null,
    remindedAt: null,
    title: 'Node.js Developer',
    company: 'Acme',
    timezone: 'Europe/Moscow',
    language: 'ru',
    ...over,
  };
}

describe('isReminderHour', () => {
  it('allows 10:00 up to, not including, 20:00 local time', () => {
    expect(isReminderHour(new Date('2026-10-16T07:00:00Z'), 'Europe/Moscow')).toBe(true); // 10:00
    expect(isReminderHour(new Date('2026-10-16T06:59:00Z'), 'Europe/Moscow')).toBe(false); // 09:59
    expect(isReminderHour(new Date('2026-10-16T16:59:00Z'), 'Europe/Moscow')).toBe(true); // 19:59
    expect(isReminderHour(new Date('2026-10-16T17:00:00Z'), 'Europe/Moscow')).toBe(false); // 20:00
  });

  it('judges by the user timezone, not the server clock', () => {
    expect(isReminderHour(NOW, 'Europe/Moscow')).toBe(true);
    expect(isReminderHour(NOW, 'America/New_York')).toBe(false);
  });

  it('falls back to UTC for a missing or unknown timezone', () => {
    expect(isReminderHour(NOW, null)).toBe(true);
    expect(isReminderHour(NOW, 'Mars/Olympus')).toBe(true);
    expect(isReminderHour(new Date('2026-10-16T22:00:00Z'), 'Mars/Olympus')).toBe(false);
  });
});

describe('isReminderToSend', () => {
  it('fires for a waiting application past the default threshold', () => {
    expect(isReminderToSend(candidate(), NOW)).toBe(true);
    expect(isReminderToSend(candidate({ lastActivityAt: daysAgo(7) }), NOW)).toBe(true);
    expect(isReminderToSend(candidate({ lastActivityAt: daysAgo(6) }), NOW)).toBe(false);
  });

  it('honours a per-application threshold', () => {
    expect(isReminderToSend(candidate({ remindAfterDays: 14 }), NOW)).toBe(false);
    expect(
      isReminderToSend(candidate({ remindAfterDays: 3, lastActivityAt: daysAgo(3) }), NOW),
    ).toBe(true);
  });

  it('only for stages that wait on the company', () => {
    expect(isReminderToSend(candidate({ stage: 'screening' }), NOW)).toBe(true);
    expect(isReminderToSend(candidate({ stage: 'tech_interview' }), NOW)).toBe(true);
    for (const stage of ['saved', 'offer', 'rejected', 'withdrawn'] as const) {
      expect(isReminderToSend(candidate({ stage }), NOW)).toBe(false);
    }
  });

  it('once per quiet spell: not again until new activity follows the reminder', () => {
    // Reminded after the last activity: already done.
    expect(isReminderToSend(candidate({ remindedAt: daysAgo(1) }), NOW)).toBe(false);
    // Reminded at the very instant of the activity counts as done too.
    const at = daysAgo(8);
    expect(isReminderToSend(candidate({ lastActivityAt: at, remindedAt: at }), NOW)).toBe(false);
    // Activity (a stage change or "remind later") since the reminder re-arms it.
    expect(
      isReminderToSend(candidate({ remindedAt: daysAgo(20), lastActivityAt: daysAgo(9) }), NOW),
    ).toBe(true);
  });

  it('waits for daytime where the user lives', () => {
    expect(isReminderToSend(candidate({ timezone: 'America/New_York' }), NOW)).toBe(false);
  });
});

describe('dueReminders', () => {
  it('keeps the due ones, oldest silence first', () => {
    const list = [
      candidate({ id: 'recent', lastActivityAt: daysAgo(8) }),
      candidate({ id: 'not-yet', lastActivityAt: daysAgo(2) }),
      candidate({ id: 'oldest', lastActivityAt: daysAgo(30) }),
      candidate({ id: 'reminded', remindedAt: daysAgo(1) }),
    ];
    expect(dueReminders(list, NOW).map((c) => c.id)).toEqual(['oldest', 'recent']);
  });
});

describe('snoozeDays', () => {
  it('promises the application threshold', () => {
    expect(snoozeDays({ remindAfterDays: null })).toBe(7);
    expect(snoozeDays({ remindAfterDays: 10 })).toBe(10);
  });
});
