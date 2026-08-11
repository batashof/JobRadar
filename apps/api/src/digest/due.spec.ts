import { localMinutes, resolveDue, SLOT_GRACE_MINUTES } from './due';

/** 2026-08-11, 09:05 UTC. */
const at = (iso: string) => new Date(iso);

describe('localMinutes', () => {
  it('resolves the wall clock in the given zone', () => {
    expect(localMinutes(at('2026-08-11T09:05:00Z'), 'UTC')).toBe(9 * 60 + 5);
    // Belgrade is UTC+2 in August.
    expect(localMinutes(at('2026-08-11T09:05:00Z'), 'Europe/Belgrade')).toBe(11 * 60 + 5);
  });

  it('falls back to UTC on a bogus zone instead of throwing', () => {
    expect(localMinutes(at('2026-08-11T09:05:00Z'), 'Mars/Olympus')).toBe(9 * 60 + 5);
  });
});

describe('resolveDue', () => {
  const base = { sendTimes: ['09:00'], timezone: 'UTC', lastSentKey: null };

  it('is idle before the first slot of the day', () => {
    expect(resolveDue({ ...base, now: at('2026-08-11T08:59:00Z') })).toEqual({ kind: 'idle' });
  });

  it('fires once the slot has come round', () => {
    expect(resolveDue({ ...base, now: at('2026-08-11T09:00:00Z') })).toEqual({
      kind: 'send',
      key: '2026-08-11 09:00',
      slot: '09:00',
    });
  });

  it('does not fire the same slot twice', () => {
    expect(
      resolveDue({
        ...base,
        now: at('2026-08-11T09:30:00Z'),
        lastSentKey: '2026-08-11 09:00',
      }),
    ).toEqual({ kind: 'idle' });
  });

  it('fires again the next day', () => {
    expect(
      resolveDue({
        ...base,
        now: at('2026-08-12T09:01:00Z'),
        lastSentKey: '2026-08-11 09:00',
      }),
    ).toMatchObject({ kind: 'send', key: '2026-08-12 09:00' });
  });

  it('takes the latest elapsed slot, not the earliest', () => {
    // Both 09:00 and 13:00 have passed; only the newer one is worth sending —
    // its candidate pool already contains the older one's.
    expect(
      resolveDue({
        ...base,
        sendTimes: ['09:00', '13:00'],
        now: at('2026-08-11T13:10:00Z'),
      }),
    ).toMatchObject({ kind: 'send', slot: '13:00' });
  });

  it('still fires the earlier slot when the later one has not come round', () => {
    expect(
      resolveDue({
        ...base,
        sendTimes: ['09:00', '19:00'],
        now: at('2026-08-11T09:10:00Z'),
      }),
    ).toMatchObject({ kind: 'send', slot: '09:00' });
  });

  it('marks a slot stale rather than sending a morning digest at night', () => {
    const late = at(`2026-08-11T${String(9 + SLOT_GRACE_MINUTES / 60 + 1).padStart(2, '0')}:00:00Z`);
    expect(resolveDue({ ...base, now: late })).toMatchObject({
      kind: 'stale',
      key: '2026-08-11 09:00',
    });
  });

  it('still sends at the very edge of the grace window', () => {
    const edge = at('2026-08-11T12:00:00Z'); // exactly 180 minutes late
    expect(resolveDue({ ...base, now: edge })).toMatchObject({ kind: 'send' });
  });

  it('resolves the day and the slot in the user timezone, not UTC', () => {
    // 22:30 UTC is already the next day, 00:30, in Belgrade — so a 00:00 slot
    // is due, keyed to the 12th, even though UTC still says the 11th.
    expect(
      resolveDue({
        sendTimes: ['00:00'],
        timezone: 'Europe/Belgrade',
        lastSentKey: null,
        now: at('2026-08-11T22:30:00Z'),
      }),
    ).toMatchObject({ kind: 'send', key: '2026-08-12 00:00' });
  });

  it('ignores malformed times instead of failing the whole run', () => {
    expect(
      resolveDue({ ...base, sendTimes: ['nonsense', '09:00'], now: at('2026-08-11T09:05:00Z') }),
    ).toMatchObject({ kind: 'send', slot: '09:00' });
    expect(
      resolveDue({ ...base, sendTimes: ['nonsense'], now: at('2026-08-11T09:05:00Z') }),
    ).toEqual({ kind: 'idle' });
  });

  it('is idle with an empty schedule', () => {
    expect(resolveDue({ ...base, sendTimes: [], now: at('2026-08-11T09:05:00Z') })).toEqual({
      kind: 'idle',
    });
  });
});
