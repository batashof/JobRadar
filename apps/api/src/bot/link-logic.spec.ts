import { resolveLink } from './link-logic';

const now = new Date('2026-08-10T12:00:00Z');
const future = new Date('2026-08-10T12:10:00Z');
const past = new Date('2026-08-10T11:50:00Z');

describe('resolveLink', () => {
  it('greets an unlinked chat that typed /start by hand', () => {
    expect(
      resolveLink({ token: '', pending: null, chatOwnerUserId: null, now }),
    ).toEqual({ kind: 'greet', alreadyLinked: false });
  });

  it('tells an already-linked chat that it is linked', () => {
    expect(
      resolveLink({ token: '', pending: null, chatOwnerUserId: 'user-1', now }),
    ).toEqual({ kind: 'greet', alreadyLinked: true });
  });

  it('links when the token is live', () => {
    expect(
      resolveLink({
        token: 'tok',
        pending: { userId: 'user-1', linkTokenExpiresAt: future },
        chatOwnerUserId: null,
        now,
      }),
    ).toEqual({ kind: 'link', userId: 'user-1' });
  });

  it('treats an expired token and an unknown token the same way', () => {
    expect(
      resolveLink({
        token: 'tok',
        pending: { userId: 'user-1', linkTokenExpiresAt: past },
        chatOwnerUserId: null,
        now,
      }),
    ).toEqual({ kind: 'expired' });
    expect(resolveLink({ token: 'tok', pending: null, chatOwnerUserId: null, now })).toEqual({
      kind: 'expired',
    });
    // A row whose token was already spent has no expiry left.
    expect(
      resolveLink({
        token: 'tok',
        pending: { userId: 'user-1', linkTokenExpiresAt: null },
        chatOwnerUserId: null,
        now,
      }),
    ).toEqual({ kind: 'expired' });
  });

  it('expires exactly at the boundary rather than one tick later', () => {
    expect(
      resolveLink({
        token: 'tok',
        pending: { userId: 'user-1', linkTokenExpiresAt: now },
        chatOwnerUserId: null,
        now,
      }),
    ).toEqual({ kind: 'expired' });
  });

  it('refuses to steal a chat that belongs to another account', () => {
    expect(
      resolveLink({
        token: 'tok',
        pending: { userId: 'user-1', linkTokenExpiresAt: future },
        chatOwnerUserId: 'user-2',
        now,
      }),
    ).toEqual({ kind: 'taken' });
  });

  it('allows re-linking the same chat to the same account', () => {
    expect(
      resolveLink({
        token: 'tok',
        pending: { userId: 'user-1', linkTokenExpiresAt: future },
        chatOwnerUserId: 'user-1',
        now,
      }),
    ).toEqual({ kind: 'link', userId: 'user-1' });
  });
});
