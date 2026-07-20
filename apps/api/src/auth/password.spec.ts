import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-value');
    await expect(verifyPassword('s3cret-valu3', hash)).resolves.toBe(false);
  });

  it('produces a different salt (and hash) each time', async () => {
    const a = await hashPassword('same-input');
    const b = await hashPassword('same-input');
    expect(a).not.toEqual(b);
    await expect(verifyPassword('same-input', a)).resolves.toBe(true);
    await expect(verifyPassword('same-input', b)).resolves.toBe(true);
  });

  it('returns false for a malformed stored hash instead of throwing', async () => {
    await expect(verifyPassword('x', 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$32768$8$1$$')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });
});
