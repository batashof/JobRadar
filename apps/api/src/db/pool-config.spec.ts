import { buildPoolConfig } from './pool-config';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

describe('buildPoolConfig', () => {
  it('passes the URL through untouched when no CA is given', () => {
    const url = 'postgresql://u:p@localhost:5432/jobradar?sslmode=require';
    expect(buildPoolConfig(url)).toEqual({ connectionString: url });
    expect(buildPoolConfig(url, '   ')).toEqual({ connectionString: url });
  });

  it('keeps an undefined URL as is (the pool connects lazily)', () => {
    expect(buildPoolConfig(undefined, PEM)).toEqual({ connectionString: undefined });
  });

  it('verifies the server against the given CA', () => {
    const config = buildPoolConfig('postgresql://u:p@pooler.supabase.com:5432/postgres', PEM);
    expect(config.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it('drops TLS params from the URL so they cannot override the CA', () => {
    const config = buildPoolConfig(
      'postgresql://u:p@pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true&application_name=api',
      PEM,
    );
    const url = new URL(config.connectionString!);
    expect(url.searchParams.has('sslmode')).toBe(false);
    expect(url.searchParams.has('uselibpqcompat')).toBe(false);
    expect(url.searchParams.get('application_name')).toBe('api');
  });

  it('keeps credentials and database intact', () => {
    const config = buildPoolConfig(
      'postgresql://postgres.abc:s%40cret@pooler.supabase.com:5432/postgres?sslmode=require',
      PEM,
    );
    const url = new URL(config.connectionString!);
    expect(url.username).toBe('postgres.abc');
    expect(url.password).toBe('s%40cret');
    expect(url.pathname).toBe('/postgres');
  });

  it('unescapes a PEM stored with literal \\n', () => {
    const escaped = PEM.replace(/\n/g, '\\n');
    const config = buildPoolConfig('postgresql://u:p@h:5432/db', escaped);
    expect(config.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });
});
