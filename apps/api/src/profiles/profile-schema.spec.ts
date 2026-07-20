import { profileCreateSchema, profileUpdateSchema } from '@jobradar/shared';

describe('profile schemas (shared contract)', () => {
  it('applies defaults for optional fields on create', () => {
    const parsed = profileCreateSchema.parse({ name: 'Backend Go' });
    expect(parsed).toMatchObject({
      name: 'Backend Go',
      keywords: [],
      stack: [],
      workFormat: [],
      employmentType: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      isActive: true,
    });
  });

  it('requires a non-empty name', () => {
    expect(profileCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects unknown enum values', () => {
    expect(
      profileCreateSchema.safeParse({ name: 'x', workFormat: ['galactic'] }).success,
    ).toBe(false);
  });

  it('uppercases and length-checks the currency', () => {
    expect(profileCreateSchema.parse({ name: 'x', salaryCurrency: 'usd' }).salaryCurrency).toBe(
      'USD',
    );
    expect(profileCreateSchema.safeParse({ name: 'x', salaryCurrency: 'dollars' }).success).toBe(
      false,
    );
  });

  it('rejects salaryMin greater than salaryMax', () => {
    expect(
      profileCreateSchema.safeParse({ name: 'x', salaryMin: 5000, salaryMax: 1000 }).success,
    ).toBe(false);
    expect(
      profileCreateSchema.safeParse({ name: 'x', salaryMin: 1000, salaryMax: 5000 }).success,
    ).toBe(true);
  });

  it('update schema allows a subset of fields', () => {
    const parsed = profileUpdateSchema.parse({ isActive: false });
    expect(parsed).toEqual({ isActive: false });
  });
});
