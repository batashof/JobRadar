import {
  addPlanBlockSchema,
  correctEstimate,
  isRotting,
  localDayKey,
  type PlanBlockItem,
  plannedMinutes,
  reorderPlanBlocksSchema,
  updatePlanBlockSchema,
  updatePlannerSettingsSchema,
} from '@jobradar/shared';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('planner schemas (shared contract, ADR-015)', () => {
  it('add block requires a title and a known category', () => {
    expect(
      addPlanBlockSchema.safeParse({ title: 'Apply to Acme', category: 'job_search' }).success,
    ).toBe(true);
    expect(addPlanBlockSchema.safeParse({ title: '', category: 'job_search' }).success).toBe(false);
    expect(addPlanBlockSchema.safeParse({ title: 'x', category: 'gardening' }).success).toBe(false);
  });

  it('add block accepts a source ref and a debt backlink', () => {
    const parsed = addPlanBlockSchema.parse({
      title: 'Follow up: Acme',
      category: 'job_search',
      sourceKind: 'application_followup',
      sourceRef: { applicationId: UUID },
      estimateMinutes: 15,
      carriedFromBlockId: UUID,
    });
    expect(parsed.sourceRef).toEqual({ applicationId: UUID });
    expect(parsed.carriedFromBlockId).toBe(UUID);
  });

  it('bounds the estimate so a "timebox" stays a timebox', () => {
    expect(addPlanBlockSchema.safeParse({ title: 'x', category: 'other', estimateMinutes: 4 }).success).toBe(false);
    expect(addPlanBlockSchema.safeParse({ title: 'x', category: 'other', estimateMinutes: 481 }).success).toBe(false);
  });

  it('update is partial and never empties the title', () => {
    expect(updatePlanBlockSchema.parse({ estimateMinutes: 45 })).toEqual({ estimateMinutes: 45 });
    expect(updatePlanBlockSchema.parse({ details: null })).toEqual({ details: null });
    expect(updatePlanBlockSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('reorder takes a non-empty list of uuids', () => {
    expect(reorderPlanBlocksSchema.safeParse({ blockIds: [UUID] }).success).toBe(true);
    expect(reorderPlanBlocksSchema.safeParse({ blockIds: [] }).success).toBe(false);
    expect(reorderPlanBlocksSchema.safeParse({ blockIds: ['nope'] }).success).toBe(false);
  });

  it('settings validate ritual times as HH:MM', () => {
    expect(updatePlannerSettingsSchema.safeParse({ morningRitualAt: '09:30' }).success).toBe(true);
    expect(updatePlannerSettingsSchema.safeParse({ morningRitualAt: '9:30' }).success).toBe(false);
    expect(updatePlannerSettingsSchema.safeParse({ eveningReviewAt: '24:00' }).success).toBe(false);
  });
});

describe('planner helpers', () => {
  it('corrects estimates by the personal factor', () => {
    expect(correctEstimate(30, 1)).toBe(30);
    expect(correctEstimate(30, 1.8)).toBe(54);
    // A missing or nonsensical factor must never shrink the estimate to zero.
    expect(correctEstimate(30, 0)).toBe(30);
    expect(correctEstimate(30, Number.NaN)).toBe(30);
  });

  it('counts committed minutes and ignores dropped blocks', () => {
    const blocks = [
      { status: 'pending', correctedEstimateMinutes: 30 },
      { status: 'done', correctedEstimateMinutes: 45 },
      { status: 'dropped', correctedEstimateMinutes: 60 },
    ] satisfies Pick<PlanBlockItem, 'status' | 'correctedEstimateMinutes'>[];
    expect(plannedMinutes(blocks)).toBe(75);
  });

  it('marks a block as rotting from the third carry', () => {
    expect(isRotting({ carryCount: 2 })).toBe(false);
    expect(isRotting({ carryCount: 3 })).toBe(true);
  });

  it('resolves the local day in the user timezone', () => {
    // 2026-07-23T22:30Z is already the 24th in Moscow, still the 23rd in UTC.
    const instant = new Date('2026-07-23T22:30:00Z');
    expect(localDayKey(instant, 'UTC')).toBe('2026-07-23');
    expect(localDayKey(instant, 'Europe/Moscow')).toBe('2026-07-24');
    expect(localDayKey(instant, 'America/Los_Angeles')).toBe('2026-07-23');
  });

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    expect(localDayKey(new Date('2026-07-23T10:00:00Z'), 'Mars/Olympus')).toBe('2026-07-23');
  });
});
