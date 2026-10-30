import { titleFamilies } from '../score';
import cases from './title-cases.json';

/**
 * The regression set of the title dictionary (ADR-035): every title the daily
 * quality audit ever fixed, plus the hand-picked ones. The audit appends a
 * case with each word it adds and refuses a word that would break one here.
 */
describe('title-cases.json', () => {
  it.each(cases.map((c) => [c.title, c.families] as const))('%s → %j', (title, families) => {
    expect([...titleFamilies(title)].sort()).toEqual([...families].sort());
  });
});
