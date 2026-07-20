import { parseCookies } from './cookies';

describe('parseCookies', () => {
  it('parses a multi-cookie header', () => {
    expect(parseCookies('a=1; jr_session=abc.def; b=2')).toEqual({
      a: '1',
      jr_session: 'abc.def',
      b: '2',
    });
  });

  it('url-decodes values', () => {
    expect(parseCookies('x=a%20b')).toEqual({ x: 'a b' });
  });

  it('returns an empty object for undefined or empty headers', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  it('ignores malformed segments without an equals sign', () => {
    expect(parseCookies('nonsense; y=2')).toEqual({ y: '2' });
  });
});
