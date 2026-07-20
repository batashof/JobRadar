import {
  DESCRIPTION_HIT_VALUE,
  diffMatches,
  FILTER_ONLY_SCORE,
  KEYWORD_WEIGHT,
  scoreMatch,
  STACK_WEIGHT,
  type MatchProfileInput,
  type MatchVacancyInput,
} from './match-logic';

const profile = (overrides: Partial<MatchProfileInput> = {}): MatchProfileInput => ({
  keywords: [],
  stack: [],
  workFormat: [],
  employmentType: [],
  salaryMin: null,
  salaryCurrency: null,
  ...overrides,
});

const vacancy = (overrides: Partial<MatchVacancyInput> = {}): MatchVacancyInput => ({
  title: 'Senior React Developer',
  description: 'We build web apps with TypeScript and Node.js.',
  workFormat: null,
  employmentType: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  ...overrides,
});

describe('scoreMatch', () => {
  describe('keywords', () => {
    it('matches a keyword in the title with full weight', () => {
      expect(scoreMatch(profile({ keywords: ['react'] }), vacancy())).toBe(1);
    });

    it('weights a description-only hit lower than a title hit', () => {
      expect(scoreMatch(profile({ keywords: ['typescript'] }), vacancy())).toBe(
        DESCRIPTION_HIT_VALUE,
      );
    });

    it('averages across keywords', () => {
      const score = scoreMatch(profile({ keywords: ['react', 'python'] }), vacancy());
      expect(score).toBeCloseTo(0.5, 5);
    });

    it('rejects when no keyword matches', () => {
      expect(scoreMatch(profile({ keywords: ['python'] }), vacancy())).toBeNull();
    });

    it('is case-insensitive', () => {
      expect(scoreMatch(profile({ keywords: ['REACT'] }), vacancy())).toBe(1);
    });

    it('respects word boundaries ("go" must not hit "google")', () => {
      const v = vacancy({ title: 'Marketing lead', description: 'Google Ads specialist' });
      expect(scoreMatch(profile({ keywords: ['go'] }), v)).toBeNull();
    });

    it('matches Cyrillic keywords at word boundaries', () => {
      const v = vacancy({ title: 'Разработчик на Реакте', description: 'Ищем реакт разработчика' });
      expect(scoreMatch(profile({ keywords: ['реакт'] }), v)).toBe(DESCRIPTION_HIT_VALUE);
    });

    it('handles regex-special characters in keywords (c++)', () => {
      const v = vacancy({ title: 'C++ Engineer', description: '' });
      expect(scoreMatch(profile({ keywords: ['c++'] }), v)).toBe(1);
    });

    it('matches multi-word keywords as a phrase', () => {
      const v = vacancy({ title: 'Frontend Engineer', description: 'Strong product engineer role' });
      expect(scoreMatch(profile({ keywords: ['product engineer'] }), v)).toBe(
        DESCRIPTION_HIT_VALUE,
      );
    });
  });

  describe('stack', () => {
    it('scores by stack alone when no keywords are set', () => {
      const score = scoreMatch(profile({ stack: ['typescript', 'go'] }), vacancy());
      expect(score).toBeCloseTo(DESCRIPTION_HIT_VALUE / 2, 5);
    });

    it('rejects when only stack is set and nothing hits', () => {
      expect(scoreMatch(profile({ stack: ['rust'] }), vacancy())).toBeNull();
    });

    it('combines keyword and stack scores with weights', () => {
      const score = scoreMatch(
        profile({ keywords: ['react'], stack: ['typescript'] }),
        vacancy(),
      );
      expect(score).toBeCloseTo(KEYWORD_WEIGHT * 1 + STACK_WEIGHT * DESCRIPTION_HIT_VALUE, 5);
    });

    it('keeps a keyword match even when the stack misses entirely', () => {
      const score = scoreMatch(profile({ keywords: ['react'], stack: ['rust'] }), vacancy());
      expect(score).toBeCloseTo(KEYWORD_WEIGHT, 5);
    });
  });

  describe('hard filters', () => {
    it('rejects a conflicting work format', () => {
      const v = vacancy({ workFormat: 'onsite' });
      expect(scoreMatch(profile({ keywords: ['react'], workFormat: ['remote'] }), v)).toBeNull();
    });

    it('passes an unknown work format', () => {
      expect(scoreMatch(profile({ keywords: ['react'], workFormat: ['remote'] }), vacancy())).toBe(
        1,
      );
    });

    it('rejects a conflicting employment type', () => {
      const v = vacancy({ employmentType: 'freelance' });
      expect(
        scoreMatch(profile({ keywords: ['react'], employmentType: ['full_time'] }), v),
      ).toBeNull();
    });

    it('rejects when the vacancy salary ceiling is below the profile minimum', () => {
      const v = vacancy({ salaryMin: 1000, salaryMax: 3000, salaryCurrency: 'USD' });
      expect(
        scoreMatch(profile({ keywords: ['react'], salaryMin: 5000, salaryCurrency: 'USD' }), v),
      ).toBeNull();
    });

    it('passes when the vacancy salary reaches the profile minimum', () => {
      const v = vacancy({ salaryMin: 4000, salaryMax: 6000, salaryCurrency: 'USD' });
      expect(
        scoreMatch(profile({ keywords: ['react'], salaryMin: 5000, salaryCurrency: 'USD' }), v),
      ).toBe(1);
    });

    it('skips the salary check across different currencies', () => {
      const v = vacancy({ salaryMin: 100, salaryMax: 200, salaryCurrency: 'RUB' });
      expect(
        scoreMatch(profile({ keywords: ['react'], salaryMin: 5000, salaryCurrency: 'USD' }), v),
      ).toBe(1);
    });

    it('treats non-positive vacancy salaries as unknown (0/0 from RemoteOK)', () => {
      const v = vacancy({ salaryMin: 0, salaryMax: 0, salaryCurrency: 'USD' });
      expect(
        scoreMatch(profile({ keywords: ['react'], salaryMin: 5000, salaryCurrency: 'USD' }), v),
      ).toBe(1);
    });
  });

  it('gives filter-only profiles a low flat score', () => {
    expect(scoreMatch(profile({ workFormat: ['remote'] }), vacancy({ workFormat: 'remote' }))).toBe(
      FILTER_ONLY_SCORE,
    );
  });
});

describe('diffMatches', () => {
  it('splits desired vs existing into inserts, updates and deletes', () => {
    const existing = new Map([
      ['keep', 0.8],
      ['rescore', 0.5],
      ['drop', 0.4],
    ]);
    const desired = new Map([
      ['keep', 0.8],
      ['rescore', 0.9],
      ['new', 0.7],
    ]);

    const diff = diffMatches(existing, desired);
    expect(diff.inserts).toEqual([{ vacancyId: 'new', score: 0.7 }]);
    expect(diff.updates).toEqual([{ vacancyId: 'rescore', score: 0.9 }]);
    expect(diff.deletes).toEqual(['drop']);
  });

  it('ignores float noise below the epsilon', () => {
    const diff = diffMatches(new Map([['a', 0.7]]), new Map([['a', 0.7 + 1e-9]]));
    expect(diff.updates).toEqual([]);
  });

  it('deletes everything when nothing is desired (inactive profile)', () => {
    const diff = diffMatches(new Map([['a', 1]]), new Map());
    expect(diff).toEqual({ inserts: [], updates: [], deletes: ['a'] });
  });
});
