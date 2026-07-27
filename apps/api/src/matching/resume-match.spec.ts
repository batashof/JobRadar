import { buildResumeMatchPrompt, overallScore, parseResumeMatchReply } from './resume-match';

const VACANCY = { title: 'Senior React', company: 'Acme', description: 'React, TypeScript, remote.' };

const FULL_REPLY = JSON.stringify({
  stack: { score: 90, note: 'React/TS overlap' },
  role: { score: 80, note: 'Frontend direction' },
  experience: { score: 70, note: 'Senior level' },
  location: { score: 60, note: 'Timezone works' },
  summary: 'Strong fit overall.',
});

describe('buildResumeMatchPrompt', () => {
  it('demands strict per-criterion JSON in Russian by default and includes both texts', () => {
    const { system, user } = buildResumeMatchPrompt(VACANCY, 'React dev, 8 years.');
    expect(system).toContain('"score"');
    expect(system).toContain('"note"');
    expect(system).toContain('"summary"');
    expect(system).toContain('по-русски');
    expect(user).toContain('Вакансия: Senior React — Acme');
    expect(user).toContain('React dev, 8 years.');
  });

  it('builds an English prompt when lang is en', () => {
    const { system, user } = buildResumeMatchPrompt(VACANCY, 'React dev, 8 years.', 'en');
    expect(system).toContain('"summary"');
    expect(system).toContain('in English');
    expect(system).not.toContain('по-русски');
    expect(user).toContain('Vacancy: Senior React — Acme');
    expect(user).toContain('Candidate resume:');
  });

  it('describes all four criteria including location compatibility', () => {
    const ru = buildResumeMatchPrompt(VACANCY, 'x').system;
    for (const key of ['stack', 'role', 'experience', 'location']) expect(ru).toContain(key);
    expect(ru).toContain('локац');
    expect(buildResumeMatchPrompt(VACANCY, 'x', 'en').system).toContain('sanctions');
  });

  it('includes the vacancy location line when present', () => {
    const withLoc = { ...VACANCY, location: 'Kyiv, Ukraine (remote)' };
    expect(buildResumeMatchPrompt(withLoc, 'from Minsk').user).toContain(
      'Локация вакансии: Kyiv, Ukraine (remote)',
    );
    expect(buildResumeMatchPrompt(withLoc, 'from Minsk', 'en').user).toContain(
      'Vacancy location: Kyiv, Ukraine (remote)',
    );
  });

  it('omits the location line when the vacancy has no location', () => {
    expect(buildResumeMatchPrompt(VACANCY, 'x').user).not.toContain('Локация вакансии');
    expect(buildResumeMatchPrompt({ ...VACANCY, location: null }, 'x').user).not.toContain(
      'Локация вакансии',
    );
  });
});

describe('overallScore', () => {
  it('weights technologies the most and renormalizes over present criteria', () => {
    // 0.4*.9 + 0.25*.8 + 0.2*.7 + 0.15*.6 = 0.79
    expect(
      overallScore([
        { key: 'stack', score: 0.9, note: '' },
        { key: 'role', score: 0.8, note: '' },
        { key: 'experience', score: 0.7, note: '' },
        { key: 'location', score: 0.6, note: '' },
      ]),
    ).toBeCloseTo(0.79, 5);

    // Missing criteria: weights renormalize — (0.4*1 + 0.25*0) / 0.65.
    expect(
      overallScore([
        { key: 'stack', score: 1, note: '' },
        { key: 'role', score: 0, note: '' },
      ]),
    ).toBeCloseTo(0.4 / 0.65, 5);
  });
});

describe('parseResumeMatchReply', () => {
  it('parses the per-criterion shape into a breakdown and a weighted overall', () => {
    const parsed = parseResumeMatchReply(FULL_REPLY);
    expect(parsed?.score).toBeCloseTo(0.79, 5);
    expect(parsed?.explanation).toBe('Strong fit overall.');
    expect(parsed?.breakdown).toEqual([
      { key: 'stack', score: 0.9, note: 'React/TS overlap' },
      { key: 'role', score: 0.8, note: 'Frontend direction' },
      { key: 'experience', score: 0.7, note: 'Senior level' },
      { key: 'location', score: 0.6, note: 'Timezone works' },
    ]);
  });

  it('extracts a nested JSON object wrapped in prose or code fences', () => {
    const reply = 'Оценка:\n```json\n{"stack":{"score":40,"note":"Другой стек"},"summary":"s"}\n```';
    const parsed = parseResumeMatchReply(reply);
    expect(parsed?.score).toBeCloseTo(0.4, 5);
    expect(parsed?.breakdown).toEqual([{ key: 'stack', score: 0.4, note: 'Другой стек' }]);
  });

  it('clamps out-of-range criterion scores to [0, 1]', () => {
    expect(parseResumeMatchReply('{"stack":{"score":150,"note":"x"}}')?.breakdown?.[0]?.score).toBe(
      1,
    );
    expect(parseResumeMatchReply('{"stack":{"score":-5,"note":"x"}}')?.breakdown?.[0]?.score).toBe(
      0,
    );
  });

  it('accepts the legacy flat {score, explanation} shape with an empty breakdown', () => {
    expect(parseResumeMatchReply('{"score": 85, "explanation": "Сильное совпадение."}')).toEqual({
      score: 0.85,
      explanation: 'Сильное совпадение.',
      breakdown: [],
    });
    expect(parseResumeMatchReply('{"score": 150, "explanation": "x"}')?.score).toBe(1);
  });

  it('returns null on garbage', () => {
    expect(parseResumeMatchReply('sorry, cannot help')).toBeNull();
    expect(parseResumeMatchReply('{"score": "high"}')).toBeNull();
  });
});
