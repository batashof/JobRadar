import { vacancyQuerySchema } from '@jobradar/shared';

describe('vacancyQuerySchema (shared contract)', () => {
  it('applies defaults for an empty query', () => {
    expect(vacancyQuerySchema.parse({})).toEqual({
      workFormat: [],
      employmentType: [],
      page: 1,
      pageSize: 20,
    });
  });

  it('coerces numeric strings for page, pageSize and salaryMin', () => {
    const parsed = vacancyQuerySchema.parse({ page: '3', pageSize: '10', salaryMin: '5000' });
    expect(parsed).toMatchObject({ page: 3, pageSize: 10, salaryMin: 5000 });
  });

  it('parses comma-separated enum filters', () => {
    const parsed = vacancyQuerySchema.parse({ workFormat: 'remote,hybrid' });
    expect(parsed.workFormat).toEqual(['remote', 'hybrid']);
  });

  it('accepts repeated params as arrays', () => {
    const parsed = vacancyQuerySchema.parse({ employmentType: ['full_time', 'freelance'] });
    expect(parsed.employmentType).toEqual(['full_time', 'freelance']);
  });

  it('rejects unknown enum values and out-of-range pageSize', () => {
    expect(vacancyQuerySchema.safeParse({ workFormat: 'galactic' }).success).toBe(false);
    expect(vacancyQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(vacancyQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('trims the search query', () => {
    expect(vacancyQuerySchema.parse({ q: '  react  ' }).q).toBe('react');
  });
});
