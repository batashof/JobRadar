import { buildResumeMatchPrompt, parseResumeMatchReply } from './resume-match';

const VACANCY = { title: 'Senior React', company: 'Acme', description: 'React, TypeScript, remote.' };

describe('buildResumeMatchPrompt', () => {
  it('demands strict JSON in Russian by default and includes both texts', () => {
    const { system, user } = buildResumeMatchPrompt(VACANCY, 'React dev, 8 years.');
    expect(system).toContain('"score"');
    expect(system).toContain('"explanation"');
    expect(system).toContain('по-русски');
    expect(user).toContain('Вакансия: Senior React — Acme');
    expect(user).toContain('React dev, 8 years.');
  });

  it('builds an English prompt when lang is en', () => {
    const { system, user } = buildResumeMatchPrompt(VACANCY, 'React dev, 8 years.', 'en');
    expect(system).toContain('"score"');
    expect(system).toContain('in English');
    expect(system).not.toContain('по-русски');
    expect(user).toContain('Vacancy: Senior React — Acme');
    expect(user).toContain('Candidate resume:');
  });

  it('instructs the model to weigh location compatibility in both languages', () => {
    expect(buildResumeMatchPrompt(VACANCY, 'x').system).toContain('локацию');
    expect(buildResumeMatchPrompt(VACANCY, 'x', 'en').system).toContain('location');
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

describe('parseResumeMatchReply', () => {
  it('parses a clean JSON reply and normalizes the score to [0, 1]', () => {
    expect(
      parseResumeMatchReply('{"score": 85, "explanation": "Сильное совпадение по стеку."}'),
    ).toEqual({ score: 0.85, explanation: 'Сильное совпадение по стеку.' });
  });

  it('extracts JSON wrapped in prose or code fences', () => {
    const reply = 'Вот оценка:\n```json\n{"score": 40, "explanation": "Другой стек."}\n```';
    expect(parseResumeMatchReply(reply)).toEqual({ score: 0.4, explanation: 'Другой стек.' });
  });

  it('clamps out-of-range scores', () => {
    expect(parseResumeMatchReply('{"score": 150, "explanation": "x"}')?.score).toBe(1);
    expect(parseResumeMatchReply('{"score": -5, "explanation": "x"}')?.score).toBe(0);
  });

  it('returns null on garbage', () => {
    expect(parseResumeMatchReply('sorry, cannot help')).toBeNull();
    expect(parseResumeMatchReply('{"score": "high"}')).toBeNull();
  });
});
