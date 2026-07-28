import { parseSalaryString } from './salary';

describe('parseSalaryString', () => {
  it('parses annual "k" ranges', () => {
    expect(parseSalaryString('$150k - $230k')).toEqual({
      min: 150000,
      max: 230000,
      currency: 'USD',
    });
  });

  it('parses comma-grouped figures', () => {
    expect(parseSalaryString('$175,000 - $215,000 USD + equity')).toEqual({
      min: 175000,
      max: 215000,
      currency: 'USD',
    });
  });

  it('parses a single figure with no max', () => {
    expect(parseSalaryString('$36k')).toEqual({ min: 36000, max: null, currency: 'USD' });
  });

  it('rejects non-annual rates', () => {
    for (const raw of ['$120 - $170 /hour', '$3.5k–$4.9k/mo', '€6k per month', '$800/day']) {
      expect(parseSalaryString(raw)).toEqual({ min: null, max: null, currency: null });
    }
  });

  it('returns nulls for empty or unparseable strings', () => {
    expect(parseSalaryString('')).toEqual({ min: null, max: null, currency: null });
    expect(parseSalaryString(undefined)).toEqual({ min: null, max: null, currency: null });
    expect(parseSalaryString('Competitive')).toEqual({ min: null, max: null, currency: null });
  });

  it('detects non-USD currencies', () => {
    expect(parseSalaryString('€90k - €120k')).toMatchObject({ currency: 'EUR' });
    expect(parseSalaryString('£70k')).toMatchObject({ currency: 'GBP' });
  });
});
