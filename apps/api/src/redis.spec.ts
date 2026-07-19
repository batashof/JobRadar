import { redisConnectionFromUrl } from './redis';

describe('redisConnectionFromUrl', () => {
  it('parses redis:// URLs', () => {
    expect(redisConnectionFromUrl('redis://localhost:6379')).toMatchObject({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    });
  });

  it('parses rediss:// URLs with credentials and enables TLS', () => {
    const conn = redisConnectionFromUrl('rediss://default:p%40ss@eu1.upstash.io:6379');
    expect(conn).toMatchObject({
      host: 'eu1.upstash.io',
      port: 6379,
      username: 'default',
      password: 'p@ss',
    });
    expect(conn?.tls).toEqual({});
  });

  it('survives stray quotes and whitespace from dashboard copy-paste', () => {
    expect(redisConnectionFromUrl('  "rediss://default:x@host.upstash.io:6379"\n')).toMatchObject({
      host: 'host.upstash.io',
    });
  });

  it('returns null instead of throwing for garbage and wrong schemes', () => {
    expect(redisConnectionFromUrl('')).toBeNull();
    expect(redisConnectionFromUrl('not a url')).toBeNull();
    expect(redisConnectionFromUrl('https://xxx.upstash.io')).toBeNull(); // REST URL mistake
    expect(redisConnectionFromUrl('host:6379')).toBeNull();
  });
});
