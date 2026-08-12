import {
  buildBatchPrompt,
  type DigestCandidate,
  dropTooJunior,
  fallbackScores,
  parseBatchReply,
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
    url: 'https://acme.test/jobs/1',
    publishedAt: new Date('2026-08-10T00:00:00Z'),
    ruleScore: 0.8,
    resumeScore: 0,
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

describe('fallbackScores', () => {
  it('scales the rules score to the same percentage scale', () => {
    expect(fallbackScores([candidate({ ruleScore: 0.755 })])[0]).toMatchObject({
      score: 76,
      note: '',
    });
  });

  it('clamps a score outside 0..1', () => {
    expect(fallbackScores([candidate({ ruleScore: 1.4 })])[0]?.score).toBe(100);
    expect(fallbackScores([candidate({ ruleScore: -0.2 })])[0]?.score).toBe(0);
  });

  it('uses the cached resume score when there is no search profile', () => {
    const [scored] = fallbackScores([candidate({ ruleScore: 0, resumeScore: 0.92 })]);
    expect(scored?.score).toBe(92);
  });
});

describe('rankScore', () => {
  it('takes the better of the two cached signals', () => {
    expect(rankScore({ ruleScore: 0.3, resumeScore: 0.9 })).toBe(0.9);
    expect(rankScore({ ruleScore: 0.7, resumeScore: 0.2 })).toBe(0.7);
  });

  it('is zero when neither signal exists, so nothing is invented', () => {
    expect(rankScore({ ruleScore: 0, resumeScore: 0 })).toBe(0);
  });

  it('clamps into 0..1', () => {
    expect(rankScore({ ruleScore: 1.4, resumeScore: 0 })).toBe(1);
    expect(rankScore({ ruleScore: -0.5, resumeScore: -0.2 })).toBe(0);
  });
});

describe('buildBatchPrompt', () => {
  it('numbers the cards so the reply can be joined back on', () => {
    const { user } = buildBatchPrompt(
      [candidate({ id: 'a' }), candidate({ id: 'b', title: 'Backend Engineer' })],
      'my resume',
      'ru',
    );
    expect(user).toContain('#0');
    expect(user).toContain('#1');
    expect(user).toContain('Backend Engineer');
  });

  it('asks for notes in the account language', () => {
    expect(buildBatchPrompt([candidate()], 'r', 'ru').user).toContain('Russian');
    expect(buildBatchPrompt([candidate()], 'r', 'en').user).toContain('English');
  });

  it('caps what it sends, so a long description cannot blow up the prompt', () => {
    const { user } = buildBatchPrompt(
      [candidate({ description: 'x'.repeat(5000) })],
      'y'.repeat(20_000),
      'ru',
    );
    expect(user.length).toBeLessThan(6000);
  });

  it('omits salary when the vacancy has none', () => {
    const { user } = buildBatchPrompt(
      [candidate({ salaryMin: null, salaryMax: null, salaryCurrency: null })],
      'r',
      'ru',
    );
    expect(user).not.toContain('salary:');
  });
});

describe('parseBatchReply', () => {
  const candidates = [candidate({ id: 'a' }), candidate({ id: 'b' })];

  it('joins scores back onto the candidates by index', () => {
    const parsed = parseBatchReply('[{"i":1,"score":88,"note":"Точное совпадение стека"}]', candidates);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'b', score: 88, note: 'Точное совпадение стека' });
  });

  it('digs the array out of prose or a code fence', () => {
    expect(
      parseBatchReply('```json\n[{"i":0,"score":70}]\n```', candidates)[0]?.id,
    ).toBe('a');
    expect(parseBatchReply('Here you go: [{"i":0,"score":70}] — done', candidates)[0]?.id).toBe('a');
  });

  it('drops indexes the model invented', () => {
    // A hallucinated vacancy in a digest is worse than a shorter digest.
    expect(parseBatchReply('[{"i":7,"score":99}]', candidates)).toEqual([]);
  });

  it('clamps and rounds the score', () => {
    expect(parseBatchReply('[{"i":0,"score":140}]', candidates)[0]?.score).toBe(100);
    expect(parseBatchReply('[{"i":0,"score":-5}]', candidates)[0]?.score).toBe(0);
    expect(parseBatchReply('[{"i":0,"score":72.6}]', candidates)[0]?.score).toBe(73);
  });

  it('keeps the first verdict when an index repeats', () => {
    const parsed = parseBatchReply('[{"i":0,"score":80},{"i":0,"score":10}]', candidates);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.score).toBe(80);
  });

  it('returns nothing on garbage, so the caller can fall back', () => {
    expect(parseBatchReply('sorry, I cannot help with that', candidates)).toEqual([]);
    expect(parseBatchReply('[{"i":0,', candidates)).toEqual([]);
    expect(parseBatchReply('{"i":0,"score":80}', candidates)).toEqual([]);
    expect(parseBatchReply('', candidates)).toEqual([]);
  });

  it('skips entries without a usable score', () => {
    expect(parseBatchReply('[{"i":0,"note":"nice"},{"i":1,"score":60}]', candidates)).toHaveLength(1);
  });

  it('tolerates a missing note', () => {
    expect(parseBatchReply('[{"i":0,"score":60}]', candidates)[0]?.note).toBe('');
  });
});
