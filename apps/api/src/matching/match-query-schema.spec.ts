import { matchQuerySchema } from '@jobradar/shared';

describe('matchQuerySchema', () => {
  it('applies pagination defaults', () => {
    expect(matchQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces numeric query-string values', () => {
    expect(matchQuerySchema.parse({ page: '3', pageSize: '10' })).toEqual({
      page: 3,
      pageSize: 10,
    });
  });

  it('accepts a profile id', () => {
    const id = '4a0af0d2-9c39-4f5c-8f6e-0f2b2f9f9d11';
    expect(matchQuerySchema.parse({ profileId: id }).profileId).toBe(id);
  });

  it('rejects a malformed profile id', () => {
    expect(matchQuerySchema.safeParse({ profileId: 'nope' }).success).toBe(false);
  });

  it('caps the page size', () => {
    expect(matchQuerySchema.safeParse({ pageSize: '999' }).success).toBe(false);
  });
});
