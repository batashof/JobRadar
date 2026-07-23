import {
  debtBlocks,
  elapsedMinutes,
  ESTIMATION_MIN_SAMPLES,
  estimationFactor,
  median,
  type PlanBlockItem,
  summarizeDay,
} from '@jobradar/shared';

describe('estimation factor (ADR-015 §5)', () => {
  const sample = (estimateMinutes: number, actualMinutes: number) => ({
    estimateMinutes,
    actualMinutes,
  });

  it('stays 1 until there is enough evidence', () => {
    const few = Array.from({ length: ESTIMATION_MIN_SAMPLES - 1 }, () => sample(30, 60));
    expect(estimationFactor(few)).toBe(1);
  });

  it('is the median ratio once there are enough samples', () => {
    const samples = [
      sample(30, 60), // 2.0
      sample(30, 45), // 1.5
      sample(60, 90), // 1.5
      sample(20, 40), // 2.0
      sample(30, 30), // 1.0
    ];
    expect(estimationFactor(samples)).toBe(1.5);
  });

  it('ignores blocks with no recorded time', () => {
    const samples = [
      ...Array.from({ length: ESTIMATION_MIN_SAMPLES }, () => sample(30, 60)),
      sample(30, 0),
      sample(0, 30),
    ];
    expect(estimationFactor(samples)).toBe(2);
  });

  it('clamps a freak run instead of exploding the plan', () => {
    const samples = Array.from({ length: ESTIMATION_MIN_SAMPLES }, () => sample(5, 480));
    expect(estimationFactor(samples)).toBe(4);
  });

  it('median handles even and odd lengths', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

function block(overrides: Partial<PlanBlockItem>): PlanBlockItem {
  return {
    id: 'b',
    position: 0,
    title: 't',
    details: null,
    category: 'other',
    sourceKind: 'manual',
    sourceRef: null,
    estimateMinutes: 30,
    correctedEstimateMinutes: 30,
    actualMinutes: 0,
    status: 'pending',
    skipReason: null,
    outcomeNote: null,
    carriedFromBlockId: null,
    carryCount: 0,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('day summary (evening close-out)', () => {
  it('counts done blocks, real minutes and the debt the day leaves behind', () => {
    const review = summarizeDay(
      [
        block({ status: 'done', actualMinutes: 50, category: 'job_search' }),
        block({ status: 'partial', actualMinutes: 20, category: 'learning' }),
        block({ status: 'skipped' }),
        block({ status: 'dropped', actualMinutes: 5, correctedEstimateMinutes: 60 }),
      ],
      'rough day',
    );

    expect(review.completedBlocks).toBe(1);
    // The dropped block counts nowhere — it was deliberately taken off the day.
    expect(review.totalBlocks).toBe(3);
    expect(review.plannedMinutes).toBe(90);
    expect(review.actualMinutes).toBe(70);
    expect(review.minutesByCategory).toEqual({ job_search: 50, learning: 20 });
    expect(review.debtCreated).toBe(2);
    expect(review.note).toBe('rough day');
  });

  it('treats partial and skipped as debt, done as settled', () => {
    const debt = debtBlocks([
      block({ id: 'a', status: 'done' }),
      block({ id: 'b', status: 'partial' }),
      block({ id: 'c', status: 'skipped' }),
      block({ id: 'd', status: 'pending' }),
      block({ id: 'e', status: 'dropped' }),
    ]);
    expect(debt.map((b) => b.id)).toEqual(['b', 'c', 'd']);
  });
});

describe('elapsedMinutes', () => {
  it('adds the running clock to what the block already banked', () => {
    const now = new Date('2026-07-23T10:30:00Z');
    expect(
      elapsedMinutes({ blockId: 'b', startedAt: '2026-07-23T10:12:30Z', bankedMinutes: 25 }, now),
    ).toBe(42);
  });

  it('never goes negative on a clock skew', () => {
    const now = new Date('2026-07-23T10:00:00Z');
    expect(
      elapsedMinutes({ blockId: 'b', startedAt: '2026-07-23T10:05:00Z', bankedMinutes: 3 }, now),
    ).toBe(3);
  });
});
