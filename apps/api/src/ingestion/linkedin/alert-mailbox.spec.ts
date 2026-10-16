import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { collectRecipients, fetchAlertMessages, type AlertMailboxOptions } from './alert-mailbox';

jest.mock('imapflow', () => ({ ImapFlow: jest.fn() }));

const RAW = (subject: string) =>
  Buffer.from(
    [
      'From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
      `Subject: ${subject}`,
      'Date: Tue, 29 Sep 2026 08:00:00 +0000',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Senior Frontend Engineer</p>',
    ].join('\r\n'),
  );

const OPTIONS: AlertMailboxOptions = {
  host: 'imap.gmail.com',
  port: 993,
  user: 'alerts@example.com',
  password: 'app-pass',
  senders: ['jobalerts-noreply@linkedin.com', 'jobs-listings@linkedin.com'],
  since: new Date('2026-09-27T00:00:00Z'),
  maxMessages: 2,
};

function fakeClient(searchResults: number[][]) {
  const release = jest.fn();
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    list: jest.fn().mockResolvedValue([
      { path: 'INBOX', specialUse: '\\Inbox' },
      { path: '[Gmail]/All Mail', specialUse: '\\All' },
    ]),
    getMailboxLock: jest.fn().mockResolvedValue({ release }),
    search: jest.fn(),
    fetch: jest.fn(async function* (uids: number[]) {
      for (const uid of uids) yield { uid, source: RAW(`Alert ${uid}`), internalDate: new Date() };
    }),
  };
  for (const result of searchResults) client.search.mockResolvedValueOnce(result);
  (ImapFlow as unknown as jest.Mock).mockImplementation(() => client);
  return { client, release };
}

describe('fetchAlertMessages', () => {
  it('opens All Mail read-only and never marks anything as seen', async () => {
    const { client } = fakeClient([[], []]);
    await fetchAlertMessages(OPTIONS);
    expect(client.getMailboxLock).toHaveBeenCalledWith('[Gmail]/All Mail', { readOnly: true });
  });

  it('uses an explicit folder when configured', async () => {
    const { client } = fakeClient([[], []]);
    await fetchAlertMessages({ ...OPTIONS, mailbox: 'LinkedIn' });
    expect(client.list).not.toHaveBeenCalled();
    expect(client.getMailboxLock).toHaveBeenCalledWith('LinkedIn', { readOnly: true });
  });

  it('searches each sender since the window start and reads the newest messages only', async () => {
    const { client } = fakeClient([[10, 12], [11, 12]]);
    const messages = await fetchAlertMessages(OPTIONS);

    expect(client.search).toHaveBeenCalledWith(
      { from: 'jobalerts-noreply@linkedin.com', since: OPTIONS.since },
      { uid: true },
    );
    expect(client.search).toHaveBeenCalledWith(
      { from: 'jobs-listings@linkedin.com', since: OPTIONS.since },
      { uid: true },
    );
    expect(client.fetch).toHaveBeenCalledWith([12, 11], expect.any(Object), { uid: true });
    expect(messages.map((m) => [m.uid, m.subject])).toEqual([
      [12, 'Alert 12'],
      [11, 'Alert 11'],
    ]);
    expect(messages[0]?.html).toContain('Senior Frontend Engineer');
    expect(messages[0]?.date).toEqual(new Date('2026-09-29T08:00:00Z'));
  });

  it('releases the lock and logs out even when a fetch fails', async () => {
    const { client, release } = fakeClient([[1], []]);
    client.fetch.mockImplementation(() => {
      throw new Error('connection reset');
    });
    await expect(fetchAlertMessages(OPTIONS)).rejects.toThrow('connection reset');
    expect(release).toHaveBeenCalled();
    expect(client.logout).toHaveBeenCalled();
  });

  it('skips the fetch when nothing matched', async () => {
    const { client } = fakeClient([[], []]);
    await expect(fetchAlertMessages(OPTIONS)).resolves.toEqual([]);
    expect(client.fetch).not.toHaveBeenCalled();
  });
});

describe('alert recipients (ADR-027)', () => {
  const FORWARDED = Buffer.from(
    [
      'Delivered-To: JobRadar.Alerts+ABC234DEFGHI@gmail.com',
      'X-Original-To: jobradar.alerts+abc234defghi@gmail.com',
      'From: LinkedIn Job Alerts <JobAlerts-NoReply@LinkedIn.com>',
      'To: Jane Doe <jane@example.com>, "Team" <team@example.com>',
      'Cc: Undisclosed: other@example.com;',
      'Subject: Senior Frontend Engineer at Acme',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'body',
    ].join('\r\n'),
  );

  it('collects Delivered-To, X-Original-To, To and Cc, lowercased and de-duplicated', async () => {
    const parsed = await simpleParser(FORWARDED);
    expect(collectRecipients(parsed)).toEqual([
      'jobradar.alerts+abc234defghi@gmail.com',
      'jane@example.com',
      'team@example.com',
      'other@example.com',
    ]);
  });

  it('is empty for a message without recipient headers', async () => {
    const parsed = await simpleParser(Buffer.from('Subject: x\r\n\r\nbody'));
    expect(collectRecipients(parsed)).toEqual([]);
  });

  it('puts the sender and the recipients on each fetched message', async () => {
    const { client } = fakeClient([[7]]);
    client.fetch.mockImplementation(async function* () {
      yield { uid: 7, source: FORWARDED, internalDate: new Date() };
    });
    const [message] = await fetchAlertMessages({
      ...OPTIONS,
      senders: ['jobalerts-noreply@linkedin.com'],
    });
    expect(message?.from).toBe('jobalerts-noreply@linkedin.com');
    expect(message?.recipients).toContain('jobradar.alerts+abc234defghi@gmail.com');
  });
});
