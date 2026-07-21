import {
  buildPlanPrompt,
  buildQuestionsPrompt,
  buildReviewPrompt,
  parsePlanReply,
  parseQuestionsReply,
  parseReviewReply,
  RESUME_TEXT_LIMIT,
  slugify,
  truncate,
} from './prompts';

describe('truncate', () => {
  it('leaves short text alone and cuts long text with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    const long = 'x'.repeat(RESUME_TEXT_LIMIT + 50);
    const cut = truncate(long, RESUME_TEXT_LIMIT);
    expect(cut.length).toBe(RESUME_TEXT_LIMIT + 1);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('slugify', () => {
  it('produces an ascii slug and falls back on empty input', () => {
    expect(slugify('Event Loop & Microtasks', 0)).toBe('event-loop-microtasks');
    expect(slugify('   ', 2)).toBe('topic-3');
    expect(slugify('Замыкания', 0)).toBe('topic-1'); // non-ascii → positional fallback
  });
});

describe('buildPlanPrompt', () => {
  it('embeds the target and resume, and asks for JSON only', () => {
    const { system, user } = buildPlanPrompt('React dev, 8 years', {
      targetRole: 'Senior Frontend',
      targetSeniority: 'senior',
      focus: ['React', 'TypeScript'],
    });
    expect(system).toContain('JSON');
    expect(user).toContain('Senior Frontend');
    expect(user).toContain('senior');
    expect(user).toContain('React, TypeScript');
    expect(user).toContain('React dev, 8 years');
  });

  it('falls back to inferring the role when no target is given', () => {
    const { user } = buildPlanPrompt('resume', {});
    expect(user).toContain('infer from the resume');
  });
});

describe('parsePlanReply', () => {
  it('parses sections/topics and assigns stable unique keys', () => {
    const reply = `Here you go:\n${JSON.stringify({
      sections: [
        {
          title: 'JavaScript core',
          topics: [
            { title: 'Event loop', why: 'async questions' },
            { title: 'Event loop', why: 'duplicate title' },
          ],
        },
      ],
    })}`;
    const parsed = parsePlanReply(reply);
    expect(parsed).not.toBeNull();
    const topics = parsed!.sections[0]!.topics;
    expect(topics[0]!.key).toBe('event-loop');
    // duplicate title gets a distinct key
    expect(topics[1]!.key).not.toBe(topics[0]!.key);
    expect(new Set(topics.map((t) => t.key)).size).toBe(2);
  });

  it('drops topics without a title and empty sections', () => {
    const parsed = parsePlanReply(
      JSON.stringify({
        sections: [
          { title: 'Empty', topics: [{ why: 'no title' }] },
          { title: 'Good', topics: [{ title: 'Closures', why: '' }] },
        ],
      }),
    );
    expect(parsed!.sections).toHaveLength(1);
    expect(parsed!.sections[0]!.title).toBe('Good');
  });

  it('returns null on garbage', () => {
    expect(parsePlanReply('not json at all')).toBeNull();
    expect(parsePlanReply('{"sections": "nope"}')).toBeNull();
  });
});

describe('buildQuestionsPrompt', () => {
  it('asks for coding task statements without solutions', () => {
    const { system } = buildQuestionsPrompt({ topic: 'Arrays', kind: 'coding', count: 3 });
    expect(system).toContain('live-coding task statement');
    expect(system).toContain('No solution');
  });

  it('includes the resume only when provided', () => {
    const withResume = buildQuestionsPrompt({
      topic: 'React',
      kind: 'theory',
      count: 2,
      resumeText: 'my resume',
    });
    expect(withResume.user).toContain('my resume');
    const without = buildQuestionsPrompt({ topic: 'React', kind: 'theory', count: 2 });
    expect(without.user).not.toContain('Candidate resume');
  });
});

describe('parseQuestionsReply', () => {
  it('parses a JSON array of strings, trimming and dropping blanks', () => {
    expect(parseQuestionsReply('["  What is a closure?  ", "", "Explain hoisting"]')).toEqual([
      'What is a closure?',
      'Explain hoisting',
    ]);
  });

  it('extracts the array even when wrapped in prose', () => {
    expect(parseQuestionsReply('Sure!\n["Q1", "Q2"]\nGood luck')).toEqual(['Q1', 'Q2']);
  });

  it('returns an empty array on garbage', () => {
    expect(parseQuestionsReply('no array here')).toEqual([]);
  });
});

describe('buildReviewPrompt / parseReviewReply', () => {
  it('states that code is not executed and requests JSON', () => {
    const { system } = buildReviewPrompt('coding', 'Reverse a string', 'const r = s => ...');
    expect(system).toContain('do NOT run code');
    expect(system).toContain('score');
  });

  it('parses the review and normalises the score to [0,1]', () => {
    const reply = JSON.stringify({
      score: 80,
      verdict: 'Solid',
      correctness: 'handles edge cases',
      complexity: 'O(n)',
      style: 'clean',
      suggestions: ['add types', ''],
    });
    const parsed = parseReviewReply(reply);
    expect(parsed).not.toBeNull();
    expect(parsed!.score).toBeCloseTo(0.8);
    expect(parsed!.review.verdict).toBe('Solid');
    expect(parsed!.review.suggestions).toEqual(['add types']);
  });

  it('clamps out-of-range scores and returns null on garbage', () => {
    const over = parseReviewReply('{"score": 150, "verdict": "x", "correctness": "y"}');
    expect(over!.score).toBe(1);
    expect(parseReviewReply('nonsense')).toBeNull();
    expect(parseReviewReply('{"score": "abc"}')).toBeNull();
  });
});
