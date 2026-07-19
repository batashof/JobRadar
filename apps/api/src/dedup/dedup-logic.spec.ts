import { pickDuplicateLinks, type DedupCandidate } from './dedup-logic';

const OPTS = { windowDays: 14, threshold: 0.6 };

const day = (n: number) => new Date(Date.UTC(2026, 6, n));

const candidate = (overrides: Partial<DedupCandidate> & { id: string }): DedupCandidate => ({
  companyNormalized: 'acme',
  title: 'Senior React Developer',
  publishedAt: day(1),
  ingestedAt: day(1),
  ...overrides,
});

describe('pickDuplicateLinks', () => {
  it('links a later near-duplicate to the earliest-ingested canonical', () => {
    const links = pickDuplicateLinks(
      [
        candidate({ id: 'a', ingestedAt: day(1) }),
        candidate({ id: 'b', title: 'Senior React Developer (Remote)', ingestedAt: day(2) }),
      ],
      OPTS,
    );
    expect(links).toEqual([{ duplicateId: 'b', canonicalId: 'a' }]);
  });

  it('compresses chains: duplicate of a duplicate links to the root', () => {
    const links = pickDuplicateLinks(
      [
        candidate({ id: 'a', ingestedAt: day(1) }),
        candidate({ id: 'b', ingestedAt: day(2) }),
        candidate({ id: 'c', ingestedAt: day(3) }),
      ],
      OPTS,
    );
    expect(links).toEqual([
      { duplicateId: 'b', canonicalId: 'a' },
      { duplicateId: 'c', canonicalId: 'a' },
    ]);
  });

  it('does not link across different companies', () => {
    const links = pickDuplicateLinks(
      [
        candidate({ id: 'a', companyNormalized: 'acme' }),
        candidate({ id: 'b', companyNormalized: 'initech', ingestedAt: day(2) }),
      ],
      OPTS,
    );
    expect(links).toEqual([]);
  });

  it('respects the published-date window', () => {
    const links = pickDuplicateLinks(
      [
        candidate({ id: 'a', publishedAt: day(1) }),
        candidate({ id: 'b', publishedAt: day(20), ingestedAt: day(20) }),
      ],
      OPTS,
    );
    expect(links).toEqual([]);
  });

  it('ignores dissimilar titles within the same company', () => {
    const links = pickDuplicateLinks(
      [
        candidate({ id: 'a' }),
        candidate({ id: 'b', title: 'DevOps Engineer', ingestedAt: day(2) }),
      ],
      OPTS,
    );
    expect(links).toEqual([]);
  });

  it('never matches vacancies with unknown/empty company', () => {
    const links = pickDuplicateLinks(
      [
        candidate({ id: 'a', companyNormalized: 'unknown' }),
        candidate({ id: 'b', companyNormalized: 'unknown', ingestedAt: day(2) }),
      ],
      OPTS,
    );
    expect(links).toEqual([]);
  });

  it('falls back to ingested date when published is missing', () => {
    const links = pickDuplicateLinks(
      [
        candidate({ id: 'a', publishedAt: null, ingestedAt: day(1) }),
        candidate({ id: 'b', publishedAt: null, ingestedAt: day(3) }),
      ],
      OPTS,
    );
    expect(links).toEqual([{ duplicateId: 'b', canonicalId: 'a' }]);
  });
});
