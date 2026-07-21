import { computeFunnel } from '@jobradar/shared';

describe('computeFunnel', () => {
  it('returns zeroed steps with null conversions for an empty board', () => {
    expect(computeFunnel({})).toEqual([
      { stage: 'applied', reached: 0, conversion: null },
      { stage: 'screening', reached: 0, conversion: null },
      { stage: 'tech_interview', reached: 0, conversion: null },
      { stage: 'offer', reached: 0, conversion: null },
    ]);
  });

  it('counts "reached" cumulatively from furthest stages', () => {
    // 3 saved, 4 stopped at applied, 2 at screening, 1 reached offer
    const funnel = computeFunnel({ saved: 3, applied: 4, screening: 2, offer: 1 });
    expect(funnel).toEqual([
      { stage: 'applied', reached: 7, conversion: null },
      { stage: 'screening', reached: 3, conversion: 3 / 7 },
      { stage: 'tech_interview', reached: 1, conversion: 1 / 3 },
      { stage: 'offer', reached: 1, conversion: 1 },
    ]);
  });

  it('ignores saved-only boards for conversions', () => {
    const funnel = computeFunnel({ saved: 5 });
    expect(funnel[0]).toEqual({ stage: 'applied', reached: 0, conversion: null });
    // 0 applied → downstream conversions stay null (no 0/0)
    expect(funnel[1]?.conversion).toBeNull();
  });
});
