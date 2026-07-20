import {
  applicationCreateSchema,
  applicationReorderSchema,
  applicationUpdateSchema,
} from '@jobradar/shared';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('application schemas (shared contract)', () => {
  it('create requires a uuid vacancyId; stage optional', () => {
    expect(applicationCreateSchema.safeParse({ vacancyId: UUID }).success).toBe(true);
    expect(applicationCreateSchema.safeParse({ vacancyId: UUID, stage: 'applied' }).success).toBe(
      true,
    );
    expect(applicationCreateSchema.safeParse({ vacancyId: 'nope' }).success).toBe(false);
    expect(applicationCreateSchema.safeParse({ vacancyId: UUID, stage: 'bogus' }).success).toBe(
      false,
    );
  });

  it('update is partial and bounds remindAfterDays', () => {
    expect(applicationUpdateSchema.parse({ notes: 'hi' })).toEqual({ notes: 'hi' });
    expect(applicationUpdateSchema.parse({ remindAfterDays: null })).toEqual({
      remindAfterDays: null,
    });
    expect(applicationUpdateSchema.safeParse({ remindAfterDays: 0 }).success).toBe(false);
    expect(applicationUpdateSchema.safeParse({ remindAfterDays: 400 }).success).toBe(false);
  });

  it('reorder requires at least one column of uuid ids', () => {
    expect(
      applicationReorderSchema.safeParse({ columns: [{ stage: 'saved', orderedIds: [UUID] }] })
        .success,
    ).toBe(true);
    expect(applicationReorderSchema.safeParse({ columns: [] }).success).toBe(false);
    expect(
      applicationReorderSchema.safeParse({ columns: [{ stage: 'saved', orderedIds: ['x'] }] })
        .success,
    ).toBe(false);
  });
});
