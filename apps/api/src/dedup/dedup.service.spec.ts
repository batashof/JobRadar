import { PgDialect } from 'drizzle-orm/pg-core';

import { DedupService, dedupCandidateFilter } from './dedup.service';

describe('dedupCandidateFilter', () => {
  const render = (windowDays: number) =>
    new PgDialect().sqlToQuery(dedupCandidateFilter(windowDays));

  it('reads only canonical rows of recently active companies within twice the window', () => {
    const { sql, params } = render(14);

    expect(sql).toContain('"canonical_vacancy_id" is null');
    expect(sql).toMatch(/"ingested_at" >= now\(\) - make_interval\(days => \$\d\)/);
    expect(sql).toMatch(/"company_normalized" in \(\s*select distinct v\.company_normalized/);
    expect(sql).toMatch(/make_interval\(hours => \$\d\)/);
    expect(params).toEqual([28, 24]);
  });
});

describe('DedupService.run', () => {
  it('queries with the bounded filter and links what pickDuplicateLinks finds', async () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const candidates = [
      {
        id: 'a',
        companyNormalized: 'acme',
        title: 'Senior Frontend Engineer',
        publishedAt: now,
        ingestedAt: new Date(now.getTime() - 1000),
      },
      {
        id: 'b',
        companyNormalized: 'acme',
        title: 'Senior Frontend Engineer',
        publishedAt: now,
        ingestedAt: now,
      },
    ];
    const where = jest.fn().mockResolvedValue(candidates);
    const updateWhere = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where: updateWhere });
    const db = {
      select: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue({ where }) }),
      update: jest.fn().mockReturnValue({ set }),
    };
    const config = { get: jest.fn().mockReturnValue(undefined) };

    const result = await new DedupService(db as never, config as never).run();

    expect(new PgDialect().sqlToQuery(where.mock.calls[0][0]).params).toEqual([28, 24]);
    expect(set).toHaveBeenCalledWith({ canonicalVacancyId: 'a' });
    expect(result).toEqual({ candidates: 2, linked: 1 });
  });
});
