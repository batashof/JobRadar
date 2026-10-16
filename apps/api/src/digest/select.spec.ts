import {
  type DigestCandidate,
  dropTooJunior,
  rankScore,
  type ScoredCandidate,
  shortlist,
} from './select';

function candidate(over: Partial<DigestCandidate> = {}): DigestCandidate {
  return {
    id: 'v1',
    title: 'Senior Frontend Engineer',
    company: 'Acme',
    description: 'React, TypeScript, Node.',
    location: 'Remote',
    seniority: 'senior',
    salaryMin: 5000,
    salaryMax: 7000,
    salaryCurrency: 'USD',
    workFormat: 'remote',
    employmentType: 'full_time',
    applyContact: null,
    sourceSlug: 'remoteok',
    url: 'https://acme.test/jobs/1',
    publishedAt: new Date('2026-08-10T00:00:00Z'),
    ruleScore: 0.8,
    resumeScore: 0,
    lexScore: 0,
    ...over,
  };
}

const scored = (over: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
  ...candidate(),
  score: 70,
  note: '',
  ...over,
});

describe('shortlist', () => {
  it('keeps the best above the floor, capped', () => {
    const picked = shortlist(
      [
        scored({ id: 'a', score: 90 }),
        scored({ id: 'b', score: 55 }),
        scored({ id: 'c', score: 75 }),
      ],
      2,
      60,
    );
    expect(picked.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('breaks ties towards the fresher posting', () => {
    const picked = shortlist(
      [
        scored({ id: 'old', score: 80, publishedAt: new Date('2026-08-01T00:00:00Z') }),
        scored({ id: 'new', score: 80, publishedAt: new Date('2026-08-10T00:00:00Z') }),
      ],
      2,
      0,
    );
    expect(picked.map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('returns fewer than the cap rather than padding with weak matches', () => {
    expect(shortlist([scored({ score: 50 })], 10, 60)).toEqual([]);
  });

  it('keeps every match above the floor when there is no cap (ADR-022)', () => {
    const many = Array.from({ length: 25 }, (_, i) => scored({ id: `v${i}`, score: 61 + (i % 30) }));
    const picked = shortlist([...many, scored({ id: 'weak', score: 40 })], null, 60);
    expect(picked).toHaveLength(25);
    expect(picked.map((item) => item.id)).not.toContain('weak');
  });

  it('does not mutate the input', () => {
    const input = [scored({ id: 'a', score: 10 }), scored({ id: 'b', score: 90 })];
    shortlist(input, 2, 0);
    expect(input.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('dropTooJunior', () => {
  it('drops roles two or more grades below the resume', () => {
    const kept = dropTooJunior(
      [
        candidate({ id: 'intern', title: 'Frontend разработчик, стажер', seniority: 'intern' }),
        candidate({ id: 'junior', title: 'Junior frontend', seniority: 'junior' }),
        candidate({ id: 'middle', title: 'Frontend Developer', seniority: 'middle' }),
        candidate({ id: 'senior', title: 'Senior frontend', seniority: 'senior' }),
      ],
      'senior',
    );
    // A senior still sees middle roles — only the obvious mismatches go.
    expect(kept.map((c) => c.id)).toEqual(['middle', 'senior']);
  });

  it('reads the level off the title when ingestion never stored one', () => {
    const kept = dropTooJunior(
      [
        candidate({ id: 'a', title: 'Стажёр во фронтенд', seniority: null }),
        candidate({ id: 'b', title: 'Frontend Developer', seniority: null }),
      ],
      'senior',
    );
    expect(kept.map((c) => c.id)).toEqual(['b']);
  });

  it('keeps everything when the resume has no detectable level', () => {
    const candidates = [candidate({ seniority: 'intern' })];
    expect(dropTooJunior(candidates, null)).toHaveLength(1);
  });

  it('keeps everything for a junior resume — nothing is below it', () => {
    const candidates = [candidate({ seniority: 'intern' }), candidate({ seniority: 'junior' })];
    expect(dropTooJunior(candidates, 'junior')).toHaveLength(2);
  });
});

describe('rankScore', () => {
  it('takes the best of the signals', () => {
    expect(rankScore({ ruleScore: 0.3, resumeScore: 0.9, lexScore: 0.5 })).toBe(0.9);
    expect(rankScore({ ruleScore: 0.7, resumeScore: 0.2, lexScore: 0 })).toBe(0.7);
  });

  it('ranks on the lexical score alone when nothing is cached', () => {
    // The case that made the digest go quiet: a fresh account has no profile
    // and no scored matches, and used to rank every candidate at zero.
    expect(rankScore({ ruleScore: 0, resumeScore: 0, lexScore: 0.67 })).toBe(0.67);
  });

  it('is zero when no signal exists at all, so nothing is invented', () => {
    expect(rankScore({ ruleScore: 0, resumeScore: 0, lexScore: 0 })).toBe(0);
  });

  it('clamps into 0..1', () => {
    expect(rankScore({ ruleScore: 1.4, resumeScore: 0, lexScore: 0 })).toBe(1);
    expect(rankScore({ ruleScore: -0.5, resumeScore: -0.2, lexScore: -1 })).toBe(0);
  });
});
