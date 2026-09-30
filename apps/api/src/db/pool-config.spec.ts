import { Client } from 'pg';

import { buildPoolConfig, createPool } from './pool-config';

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

  it.each(['ssl=true', 'sslnegotiation=direct', 'sslmode=verify-full&sslrootcert=system'])(
    'leaves pg with the CA when the URL carries %s',
    (params) => {
      const url = `postgresql://u:p@pooler.supabase.com:5432/postgres?${params}`;
      const config = buildPoolConfig(url, PEM);
      // What pg itself resolves after merging the parsed URL over the config.
      const client = new Client(config) as unknown as { connectionParameters: { ssl: unknown } };
      expect(client.connectionParameters.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    },
  );

  it('rejects a malformed URL without echoing it', () => {
    const build = () => buildPoolConfig('postgresql://u:pa ss@[bad/postgres', PEM);
    expect(build).toThrow(/DATABASE_URL is not a valid URL/);
    expect(build).not.toThrow(/pa ss/);
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

describe('createPool', () => {
  it('survives an idle connection being dropped', async () => {
    const onIdleError = jest.fn();
    const pool = createPool(undefined, undefined, onIdleError);
    const error = new Error('terminating connection due to administrator command');

    // Without a listener, EventEmitter throws this out as an uncaught exception.
    expect(() => pool.emit('error', error)).not.toThrow();
    expect(onIdleError).toHaveBeenCalledWith(error);
    await pool.end();
  });

  it('applies the CA from buildPoolConfig', async () => {
    const pool = createPool('postgresql://u:p@h:5432/db?sslmode=require', PEM, jest.fn());
    expect(pool.options.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    await pool.end();
  });
});
