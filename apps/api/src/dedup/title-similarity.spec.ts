import { titleSimilarity } from './title-similarity';

describe('titleSimilarity', () => {
  it('returns 1 for identical titles regardless of case and punctuation', () => {
    expect(titleSimilarity('Senior React Developer', 'senior react developer')).toBe(1);
    expect(titleSimilarity('Senior React-Developer!', 'Senior React Developer')).toBe(1);
  });

  it('scores near-duplicates above a 0.6 threshold', () => {
    expect(
      titleSimilarity('Senior React Developer', 'Senior React Developer (Remote)'),
    ).toBeGreaterThan(0.6);
    expect(titleSimilarity('Frontend Engineer', 'Front-end Engineer')).toBeGreaterThan(0.6);
  });

  it('scores unrelated titles below the threshold', () => {
    expect(titleSimilarity('Senior React Developer', 'DevOps Engineer')).toBeLessThan(0.6);
    expect(titleSimilarity('Designer', 'Backend Developer')).toBeLessThan(0.6);
  });

  it('handles empty strings', () => {
    expect(titleSimilarity('', 'anything')).toBe(0);
  });
});
