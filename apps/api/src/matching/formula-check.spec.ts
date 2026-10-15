import { compareRankings, type RankedPair } from './formula-check';

const pair = (vacancyId: string, llmScore: number, formulaScore: number): RankedPair => ({
  vacancyId,
  llmScore,
  formulaScore,
});

describe('compareRankings', () => {
  it('passes when the top lists agree', () => {
    const pairs = [pair('a', 0.9, 90), pair('b', 0.8, 80), pair('c', 0.1, 10)];
    expect(compareRankings(pairs, 2)).toEqual({ size: 2, shared: 2, overlap: 1, pass: true, precision: 1 });
  });

  it('fails below 70% overlap', () => {
    const pairs = [pair('a', 0.9, 10), pair('b', 0.8, 80), pair('c', 0.1, 90)];
    expect(compareRankings(pairs, 2)).toMatchObject({ shared: 1, overlap: 0.5, pass: false });
  });

  it('does not pass on nothing', () => {
    expect(compareRankings([])).toEqual({ size: 0, shared: 0, overlap: 0, pass: false, precision: 0 });
  });

  it('is deterministic on ties', () => {
    const pairs = [pair('b', 1, 1), pair('a', 1, 1), pair('c', 1, 1)];
    expect(compareRankings(pairs, 2)).toMatchObject({ shared: 2, pass: true });
  });

  it('measures how much of the formula top the LLM rated a good fit', () => {
    // Different top lists, but both formula picks are vacancies the LLM liked.
    const pairs = [pair('a', 0.95, 10), pair('b', 0.9, 20), pair('c', 0.85, 90), pair('d', 0.5, 80)];
    expect(compareRankings(pairs, 2)).toMatchObject({ shared: 0, precision: 0.5 });
    expect(compareRankings([...pairs, pair('e', 0.82, 85)], 2)).toMatchObject({ precision: 1 });
  });
});
