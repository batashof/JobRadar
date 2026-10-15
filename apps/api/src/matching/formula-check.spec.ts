import { compareRankings, type RankedPair } from './formula-check';

const pair = (vacancyId: string, llmScore: number, formulaScore: number): RankedPair => ({
  vacancyId,
  llmScore,
  formulaScore,
});

describe('compareRankings', () => {
  it('passes when the top lists agree', () => {
    const pairs = [pair('a', 0.9, 90), pair('b', 0.8, 80), pair('c', 0.1, 10)];
    expect(compareRankings(pairs, 2)).toEqual({ size: 2, shared: 2, overlap: 1, pass: true });
  });

  it('fails below 70% overlap', () => {
    const pairs = [pair('a', 0.9, 10), pair('b', 0.8, 80), pair('c', 0.1, 90)];
    expect(compareRankings(pairs, 2)).toMatchObject({ shared: 1, overlap: 0.5, pass: false });
  });

  it('does not pass on nothing', () => {
    expect(compareRankings([])).toEqual({ size: 0, shared: 0, overlap: 0, pass: false });
  });

  it('is deterministic on ties', () => {
    const pairs = [pair('b', 1, 1), pair('a', 1, 1), pair('c', 1, 1)];
    expect(compareRankings(pairs, 2)).toMatchObject({ shared: 2, pass: true });
  });
});
