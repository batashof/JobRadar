import { EMPTY_FEEDBACK } from '../matching/score';
import { decide, pickForJudging, preferenceMiss } from './decide';
import { FRONTEND, vacancy } from './fixtures';

const now = new Date('2026-10-30T12:00:00Z');
const prefs = { workFormats: [], employmentTypes: [], minSalaryUsd: null, locations: [], workLanguages: ['en', 'ru'] };
const input = { profile: FRONTEND, weights: EMPTY_FEEDBACK, prefs, minScore: 60, now };
const REACT = 'We build with React, TypeScript, Next.js and Redux.';

describe('decide', () => {
  it('delivers a matching frontend vacancy', () => {
    const [d] = decide(input, [vacancy('1', 'Senior Frontend Developer', REACT)]);
    expect(d).toMatchObject({ delivered: true, reason: null, titleFamilies: ['frontend'] });
    expect(d!.score).toBeGreaterThanOrEqual(60);
  });

  it('names the family cap as the reason for another job family', () => {
    const [d] = decide(input, [vacancy('1', 'Senior SEO Specialist', REACT)]);
    expect(d).toMatchObject({ delivered: false, reason: 'wrong-family' });
  });

  it('names the level gate before anything else', () => {
    const [d] = decide(input, [vacancy('1', 'Junior Frontend Developer', REACT, { seniority: 'junior' })]);
    expect(d!.reason).toBe('too-junior');
  });

  it('names the hard preference that dropped it', () => {
    const [d] = decide(
      { ...input, prefs: { ...prefs, workFormats: ['remote'] } },
      [vacancy('1', 'Senior Frontend Developer', REACT, { workFormat: 'onsite' })],
    );
    expect(d!.reason).toBe('work-format');
  });

  it('names the floor when the score is just low', () => {
    const [d] = decide(input, [vacancy('1', 'Software Engineer', 'Python, Django, PostgreSQL')]);
    expect(d!.reason).toBe('below-floor');
  });
});

describe('preferenceMiss', () => {
  it('reads the language filter', () => {
    const v = vacancy('1', 'Desarrollador Frontend', '', { languages: { text: ['es'], required: [] } });
    expect(preferenceMiss(prefs, v)).toBe('language');
  });

  it('is null when every preference passes', () => {
    expect(preferenceMiss(prefs, vacancy('1', 'Frontend'))).toBeNull();
  });
});

describe('pickForJudging', () => {
  it('takes deliveries first, then family drops, and skips the user filters', () => {
    const decisions = decide({ ...input, prefs: { ...prefs, workFormats: ['remote'] } }, [
      vacancy('a', 'Software Engineer', 'Python'),
      vacancy('b', 'Senior SEO Specialist', REACT),
      vacancy('c', 'Senior Frontend Developer', REACT),
      vacancy('d', 'Senior Frontend Developer', REACT, { workFormat: 'onsite' }),
    ]);
    expect(pickForJudging(decisions, 10, 60).map((d) => d.vacancy.id)).toEqual(['c', 'b', 'a']);
    expect(pickForJudging(decisions, 1, 60).map((d) => d.vacancy.id)).toEqual(['c']);
  });
});
