import {
  decideNudges,
  escalationAction,
  localMinutesOfDay,
  type TickPlanState,
  timeToMinutes,
} from './tick-logic';

const NOW = new Date('2026-07-23T12:00:00Z');

function state(overrides: Partial<TickPlanState> = {}): TickPlanState {
  return {
    localMinutes: 10 * 60,
    morningRitualAt: '09:00',
    eveningReviewAt: '20:00',
    plan: { id: 'plan-1', status: 'accepted' },
    blocks: [{ id: 'b1', status: 'pending', correctedEstimateMinutes: 30, actualMinutes: 0 }],
    activeSession: null,
    debtCount: 0,
    raised: new Set<string>(),
    ...overrides,
  };
}

const kinds = (s: TickPlanState, now = NOW) => decideNudges(s, now).map((n) => n.kind);

describe('timeToMinutes / localMinutesOfDay', () => {
  it('parses HH:MM and never fires on junk', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('20:00:00')).toBe(1200);
    expect(timeToMinutes('nonsense')).toBe(Number.POSITIVE_INFINITY);
  });

  it('reads the wall clock in the user timezone', () => {
    const instant = new Date('2026-07-23T22:30:00Z');
    expect(localMinutesOfDay(instant, 'UTC')).toBe(22 * 60 + 30);
    expect(localMinutesOfDay(instant, 'Europe/Moscow')).toBe(60 + 30);
  });
});

describe('decideNudges', () => {
  it('nudges in the morning when the day was never taken on', () => {
    expect(kinds(state({ plan: null }))).toContain('morning');
    expect(kinds(state({ plan: { id: 'p', status: 'draft' } }))).toContain('morning');
    expect(kinds(state())).not.toContain('morning');
  });

  it('stays quiet before the ritual time', () => {
    expect(kinds(state({ plan: null, localMinutes: 8 * 60 }))).toEqual([]);
  });

  it('reports debt in the morning, once', () => {
    expect(kinds(state({ debtCount: 2 }))).toContain('debt');
    expect(kinds(state({ debtCount: 2, raised: new Set(['debt']) }))).not.toContain('debt');
  });

  it('asks to start something when the day is accepted and nothing is running', () => {
    expect(kinds(state())).toContain('block_start');
    expect(
      kinds(state({ activeSession: { blockId: 'b1', startedAt: NOW.toISOString(), bankedMinutes: 0 } })),
    ).not.toContain('block_start');
    // Nothing left to start.
    expect(
      kinds(state({ blocks: [{ id: 'b1', status: 'done', correctedEstimateMinutes: 30, actualMinutes: 30 }] })),
    ).not.toContain('block_start');
  });

  it('does not poke about a day that is only a draft', () => {
    expect(kinds(state({ plan: { id: 'p', status: 'draft' } }))).not.toContain('block_start');
  });

  it('pings midway only when a running block is well past its estimate', () => {
    const running = (minutesAgo: number) =>
      state({
        activeSession: {
          blockId: 'b1',
          startedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
          bankedMinutes: 0,
        },
      });
    // 30-minute estimate: 40 min is fine, 50 is over the 1.5x line.
    expect(kinds(running(40))).not.toContain('midway');
    expect(kinds(running(50))).toContain('midway');
  });

  it('raises each block-scoped nudge once', () => {
    const s = state({
      activeSession: {
        blockId: 'b1',
        startedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
        bankedMinutes: 0,
      },
      raised: new Set(['midway:b1']),
    });
    expect(kinds(s)).not.toContain('midway');
  });

  it('reminds about the review in the evening while the day is open', () => {
    expect(kinds(state({ localMinutes: 21 * 60 }))).toContain('evening');
    expect(
      kinds(state({ localMinutes: 21 * 60, plan: { id: 'p', status: 'closed' } })),
    ).not.toContain('evening');
    expect(kinds(state({ localMinutes: 21 * 60, plan: null }))).not.toContain('evening');
  });
});

describe('escalationAction', () => {
  const settings = { escalationAfterMinutes: 20, escalationMaxRepeats: 2 };
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

  it('waits until the interval has passed', () => {
    expect(escalationAction({ sentAt: ago(5), repeatIndex: 0 }, NOW, settings)).toBe('wait');
    expect(escalationAction({ sentAt: null, repeatIndex: 0 }, NOW, settings)).toBe('wait');
  });

  it('repeats, then gives up and records the nudge as ignored', () => {
    expect(escalationAction({ sentAt: ago(25), repeatIndex: 0 }, NOW, settings)).toBe('repeat');
    expect(escalationAction({ sentAt: ago(25), repeatIndex: 1 }, NOW, settings)).toBe('repeat');
    expect(escalationAction({ sentAt: ago(25), repeatIndex: 2 }, NOW, settings)).toBe('give_up');
  });
});
