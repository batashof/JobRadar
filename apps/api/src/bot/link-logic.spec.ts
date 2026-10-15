import { languageFromTelegram, type LinkInput, resolveLink } from './link-logic';

const now = new Date('2026-08-10T12:00:00Z');
const future = new Date('2026-08-10T12:10:00Z');
const past = new Date('2026-08-10T11:50:00Z');

const input = (overrides: Partial<LinkInput>): LinkInput => ({
  token: '',
  pending: null,
  chatOwnerUserId: null,
  telegramUserOwnerId: null,
  now,
  ...overrides,
});

describe('resolveLink without a token', () => {
  it('registers a Telegram user the bot has never seen (ADR-024)', () => {
    expect(resolveLink(input({}))).toEqual({ kind: 'register' });
  });

  it('greets a chat that already drives an account', () => {
    expect(resolveLink(input({ chatOwnerUserId: 'user-1' }))).toEqual({ kind: 'greet' });
  });

  it('relinks a known Telegram user whose chat was unlinked, instead of a second account', () => {
    expect(resolveLink(input({ telegramUserOwnerId: 'user-1' }))).toEqual({
      kind: 'relink',
      userId: 'user-1',
    });
  });
});

describe('resolveLink with a token', () => {
  it('links when the token is live', () => {
    expect(
      resolveLink(input({ token: 'tok', pending: { userId: 'user-1', linkTokenExpiresAt: future } })),
    ).toEqual({ kind: 'link', userId: 'user-1' });
  });

  it('treats an expired token and an unknown token the same way', () => {
    expect(
      resolveLink(input({ token: 'tok', pending: { userId: 'user-1', linkTokenExpiresAt: past } })),
    ).toEqual({ kind: 'expired' });
    expect(resolveLink(input({ token: 'tok' }))).toEqual({ kind: 'expired' });
    // A row whose token was already spent has no expiry left.
    expect(
      resolveLink(input({ token: 'tok', pending: { userId: 'user-1', linkTokenExpiresAt: null } })),
    ).toEqual({ kind: 'expired' });
  });

  it('expires exactly at the boundary rather than one tick later', () => {
    expect(
      resolveLink(input({ token: 'tok', pending: { userId: 'user-1', linkTokenExpiresAt: now } })),
    ).toEqual({ kind: 'expired' });
  });

  it('refuses to steal a chat that belongs to another account', () => {
    expect(
      resolveLink(
        input({
          token: 'tok',
          pending: { userId: 'user-1', linkTokenExpiresAt: future },
          chatOwnerUserId: 'user-2',
        }),
      ),
    ).toEqual({ kind: 'taken' });
  });

  it('refuses when the Telegram user already owns a different, bot-made account', () => {
    expect(
      resolveLink(
        input({
          token: 'tok',
          pending: { userId: 'user-1', linkTokenExpiresAt: future },
          telegramUserOwnerId: 'user-2',
        }),
      ),
    ).toEqual({ kind: 'taken' });
  });

  it('allows re-linking the same chat to the same account', () => {
    expect(
      resolveLink(
        input({
          token: 'tok',
          pending: { userId: 'user-1', linkTokenExpiresAt: future },
          chatOwnerUserId: 'user-1',
          telegramUserOwnerId: 'user-1',
        }),
      ),
    ).toEqual({ kind: 'link', userId: 'user-1' });
  });
});

describe('languageFromTelegram', () => {
  it.each([
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['be', 'ru'],
    ['kk', 'ru'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['de', 'en'],
    ['uk', 'en'],
  ])('%s → %s', (code, expected) => {
    expect(languageFromTelegram(code)).toBe(expected);
  });

  it('falls back to Russian, the first audience, when the client sends nothing', () => {
    expect(languageFromTelegram(undefined)).toBe('ru');
    expect(languageFromTelegram('')).toBe('ru');
  });
});
