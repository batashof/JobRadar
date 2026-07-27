import { vacancyQuerySchema } from '@jobradar/shared';

describe('vacancyQuerySchema (shared contract)', () => {
  it('applies defaults for an empty query', () => {
    expect(vacancyQuerySchema.parse({})).toEqual({
      workFormat: [],
      employmentType: [],
      sources: [],
      resumeFit: false,
      includeHidden: false,
      page: 1,
      pageSize: 20,
    });
  });

  it('enables resumeFit only for the literal "true"/"1" flag', () => {
    expect(vacancyQuerySchema.parse({ resumeFit: 'true' }).resumeFit).toBe(true);
    expect(vacancyQuerySchema.parse({ resumeFit: '1' }).resumeFit).toBe(true);
    expect(vacancyQuerySchema.parse({ resumeFit: 'false' }).resumeFit).toBe(false);
    expect(vacancyQuerySchema.parse({ resumeFit: 'anything' }).resumeFit).toBe(false);
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

  it('parses comma-separated source slugs', () => {
    const parsed = vacancyQuerySchema.parse({ sources: 'telegram,remoteok' });
    expect(parsed.sources).toEqual(['telegram', 'remoteok']);
  });

  it('rejects malformed source slugs', () => {
    expect(vacancyQuerySchema.safeParse({ sources: 'evil slug!' }).success).toBe(false);
    expect(vacancyQuerySchema.safeParse({ sources: 'UPPER' }).success).toBe(false);
  });
});
