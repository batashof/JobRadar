import { normalizeCompanyName } from './company-name';

describe('normalizeCompanyName', () => {
  it('lowercases and trims', () => {
    expect(normalizeCompanyName('  Acme  ')).toBe('acme');
  });

  it('strips legal suffixes in English and Russian', () => {
    expect(normalizeCompanyName('Acme LLC')).toBe('acme');
    expect(normalizeCompanyName('ООО «Рога и Копыта»')).toBe('рога и копыта');
    expect(normalizeCompanyName('Initech Inc.')).toBe('initech');
  });

  it('removes quotes and punctuation, collapses whitespace', () => {
    expect(normalizeCompanyName('«Яндекс»')).toBe('яндекс');
    expect(normalizeCompanyName('Foo,  Bar & Baz')).toBe('foo bar & baz');
  });

  it('keeps words that merely contain a legal suffix', () => {
    expect(normalizeCompanyName('Coop Collective')).toBe('coop collective');
  });
});
