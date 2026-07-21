import { decryptToken, encryptToken, signState, verifyState } from './gmail-crypto';

const SECRET = 'test-client-secret';

describe('token encryption', () => {
  it('round-trips a refresh token', () => {
    const stored = encryptToken('1//refresh-token-value', SECRET);
    expect(stored).not.toContain('refresh-token-value');
    expect(decryptToken(stored, SECRET)).toBe('1//refresh-token-value');
  });

  it('returns null for a wrong key or corrupted data', () => {
    const stored = encryptToken('secret-token', SECRET);
    expect(decryptToken(stored, 'other-secret')).toBeNull();
    expect(decryptToken('garbage', SECRET)).toBeNull();
  });
});

describe('oauth state', () => {
  it('round-trips the user id within the TTL', () => {
    const state = signState('user-123', SECRET);
    expect(verifyState(state, SECRET)).toBe('user-123');
  });

  it('rejects tampered and foreign-key states', () => {
    const state = signState('user-123', SECRET);
    expect(verifyState(`${state}x`, SECRET)).toBeNull();
    expect(verifyState(state, 'other-secret')).toBeNull();
  });

  it('rejects expired states', () => {
    const state = signState('user-123', SECRET, Date.now() - 11 * 60 * 1000);
    expect(verifyState(state, SECRET)).toBeNull();
  });
});
