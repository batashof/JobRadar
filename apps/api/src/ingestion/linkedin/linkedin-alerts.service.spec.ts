import type { ConfigService } from '@nestjs/config';

import { type sources, users, vacancies, vacancyRecipients } from '../../db/schema';
import * as vacancyUpsert from '../vacancy-upsert';
import type { AlertMessage } from './alert-mailbox';
import { ALERT_HTML, ALERT_TEXT } from './fixtures';
import {
  collectAlerts,
  collectVacancies,
  LinkedInAlertsIngestService,
} from './linkedin-alerts.service';

const source = {
  id: '00000000-0000-0000-0000-00000000000b',
  slug: 'linkedin',
  config: { senders: ['jobalerts-noreply@linkedin.com'], lookbackDays: 2, maxMessages: 10 },
} as unknown as typeof sources.$inferSelect;

const message = (uid: number, date: string, overrides: Partial<AlertMessage> = {}): AlertMessage => ({
  uid,
  date: new Date(date),
  from: 'jobalerts-noreply@linkedin.com',
  recipients: ['alerts@example.com'],
  subject: 'Senior Frontend Engineer at Acme GmbH and more',
  html: ALERT_HTML,
  text: ALERT_TEXT,
  ...overrides,
});

const configWith = (env: Record<string, string | undefined>): ConfigService =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

const CREDENTIALS = { ALERTS_IMAP_USER: 'alerts@example.com', ALERTS_IMAP_PASSWORD: 'app-pass' };

/** Fake drizzle: reads queued per `from()` table; inserts and updates recorded. */
function makeDb() {
  const queues = new Map<unknown, unknown[][]>();
  const reads: unknown[] = [];
  const writes: { kind: string; table: unknown; values?: unknown; set?: unknown }[] = [];
  const chain = () => {
    let table: unknown;
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (r: unknown[]) => unknown) =>
              Promise.resolve(queues.get(table)?.shift() ?? []).then(ok);
          }
          return (arg: unknown) => {
            if (prop === 'from' && table === undefined) {
              table = arg;
              reads.push(arg);
            }
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const db = {
    select: () => chain(),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => {
          writes.push({ kind: 'insert', table, values });
          return Promise.resolve();
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => ({
        where: () => {
          writes.push({ kind: 'update', table, set });
          return Promise.resolve();
        },
      }),
    }),
  };
  return {
    db: db as never,
    reads,
    writes,
    queue: (table: unknown, ...responses: unknown[][]) => queues.set(table, responses),
  };
}

const makeBot = () => ({ sendToUser: jest.fn().mockResolvedValue('42') });

class TestService extends LinkedInAlertsIngestService {
  mailbox = jest.fn<Promise<AlertMessage[]>, [unknown]>();

  protected override readMailbox(options: unknown): Promise<AlertMessage[]> {
    return this.mailbox(options);
  }
}

describe('LinkedInAlertsIngestService', () => {
  let upsert: jest.SpyInstance;

  beforeEach(() => {
    upsert = jest
      .spyOn(vacancyUpsert, 'upsertVacancies')
      .mockImplementation(async (_db, rows) => rows.length);
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips quietly without IMAP credentials, never touching the mailbox', async () => {
    const service = new TestService({} as never, configWith({}), makeBot() as never);
    await expect(service.ingest(source)).resolves.toEqual({
      fetched: 0,
      upserted: 0,
      notModified: true,
    });
    expect(service.mailbox).not.toHaveBeenCalled();
  });

  it('reads the configured senders over the lookback window, Gmail defaults', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS), makeBot() as never);
    service.mailbox.mockResolvedValue([]);
    const before = Date.now();

    await service.ingest(source);

    const options = service.mailbox.mock.calls[0]?.[0] as {
      host: string;
      port: number;
      senders: string[];
      since: Date;
      maxMessages: number;
    };
    expect(options).toMatchObject({
      host: 'imap.gmail.com',
      port: 993,
      user: 'alerts@example.com',
      password: 'app-pass',
      senders: ['jobalerts-noreply@linkedin.com', 'forwarding-noreply@google.com'],
      maxMessages: 10,
    });
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    expect(before - options.since.getTime()).toBeGreaterThanOrEqual(twoDays - 1000);
    expect(before - options.since.getTime()).toBeLessThan(twoDays + 1000);
  });

  it('treats a window without alert emails as not-modified, not as a broken source', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS), makeBot() as never);
    service.mailbox.mockResolvedValue([]);
    await expect(service.ingest(source)).resolves.toEqual({
      fetched: 0,
      upserted: 0,
      notModified: true,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports emails that yield no jobs as an empty run (layout changed)', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS), makeBot() as never);
    service.mailbox.mockResolvedValue([
      message(1, '2026-09-30T08:00:00Z', { html: '<p>New look!</p>', text: 'New look!' }),
    ]);
    await expect(service.ingest(source)).resolves.toEqual({ fetched: 0, upserted: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts one row per posting across all emails', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS), makeBot() as never);
    service.mailbox.mockResolvedValue([
      message(2, '2026-09-30T08:00:00Z'),
      message(1, '2026-09-29T08:00:00Z'),
    ]);

    await expect(service.ingest(source)).resolves.toEqual({ fetched: 4, upserted: 4 });
    const rows = upsert.mock.calls[0]?.[1] as { externalId: string }[];
    expect(rows.map((r) => r.externalId)).toEqual([
      '4012345678',
      '4012345679',
      '4012345680',
      '4012345681',
    ]);
  });

  it('records which users the alerts they forwarded were addressed to', async () => {
    const { db, queue, writes } = makeDb();
    const service = new TestService(db, configWith(CREDENTIALS), makeBot() as never);
    service.mailbox.mockResolvedValue([
      // The owner's own alert, to the bare mailbox.
      message(1, '2026-09-29T08:00:00Z'),
      // The same alert forwarded by a user, and one with a token nobody holds.
      message(2, '2026-09-30T08:00:00Z', { recipients: ['alerts+usertoken0001@example.com'] }),
      message(3, '2026-09-30T09:00:00Z', { recipients: ['alerts+unknowntoken1@example.com'] }),
    ]);
    queue(users, [
      { id: 'user-1', token: 'usertoken0001', language: 'en', alertsConfirmationCode: null },
    ]);
    queue(vacancies, [
      { id: 'v-1', externalId: '4012345678' },
      { id: 'v-2', externalId: '4012345679' },
    ]);

    await expect(service.ingest(source)).resolves.toEqual({ fetched: 4, upserted: 4 });

    const inserts = writes.filter((w) => w.table === vacancyRecipients);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toEqual([
      { vacancyId: 'v-1', userId: 'user-1' },
      { vacancyId: 'v-2', userId: 'user-1' },
    ]);
  });

  it("writes no recipient rows when every alert is the owner's", async () => {
    const { db, reads, writes } = makeDb();
    const service = new TestService(db, configWith(CREDENTIALS), makeBot() as never);
    service.mailbox.mockResolvedValue([message(1, '2026-09-29T08:00:00Z')]);

    await expect(service.ingest(source)).resolves.toEqual({ fetched: 4, upserted: 4 });

    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
  });

  describe('Gmail forwarding confirmations', () => {
    const confirmation = (uid: number, code: string, date = '2026-09-30T10:00:00Z') =>
      message(uid, date, {
        from: 'forwarding-noreply@google.com',
        recipients: ['alerts+usertoken0001@example.com'],
        subject: `(#${code}) Gmail Forwarding Confirmation - Receive Mail from jane@gmail.com`,
        html: '',
        text: `Confirmation code: ${code}\nhttps://mail-settings.google.com/mail/vf-abc`,
      });
    const tokenUser = (alertsConfirmationCode: string | null, language = 'en') => ({
      id: 'user-1',
      token: 'usertoken0001',
      language,
      alertsConfirmationCode,
    });

    it('relays the newest code to its user once, and remembers it', async () => {
      const { db, queue, writes } = makeDb();
      const bot = makeBot();
      const service = new TestService(db, configWith(CREDENTIALS), bot as never);
      service.mailbox.mockResolvedValue([
        confirmation(5, '111111111', '2026-09-30T09:00:00Z'),
        confirmation(6, '222222222', '2026-09-30T10:00:00Z'),
      ]);
      queue(users, [tokenUser(null, 'ru')]);

      // Confirmations are not alerts: no alert email in the window.
      await expect(service.ingest(source)).resolves.toEqual({
        fetched: 0,
        upserted: 0,
        notModified: true,
      });

      expect(bot.sendToUser).toHaveBeenCalledTimes(1);
      const [userId, text, options] = bot.sendToUser.mock.calls[0];
      expect(userId).toBe('user-1');
      expect(text).toContain('<code>222222222</code>');
      expect(text).toContain('https://mail-settings.google.com/mail/vf-abc');
      expect(text).toContain('Пересылка и POP/IMAP');
      expect(options).toEqual({ parseMode: 'HTML' });
      expect(writes).toEqual([
        {
          kind: 'update',
          table: users,
          set: expect.objectContaining({ alertsConfirmationCode: '222222222' }),
        },
      ]);
    });

    it('does not resend a code the user already got', async () => {
      const { db, queue, writes } = makeDb();
      const bot = makeBot();
      const service = new TestService(db, configWith(CREDENTIALS), bot as never);
      service.mailbox.mockResolvedValue([confirmation(5, '111111111')]);
      queue(users, [tokenUser('111111111')]);

      await service.ingest(source);

      expect(bot.sendToUser).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    });

    it('keeps the code unremembered when the send did not land', async () => {
      const { db, queue, writes } = makeDb();
      const bot = makeBot();
      bot.sendToUser.mockResolvedValue(null);
      const service = new TestService(db, configWith(CREDENTIALS), bot as never);
      service.mailbox.mockResolvedValue([confirmation(5, '111111111')]);
      queue(users, [tokenUser(null)]);

      await service.ingest(source);

      expect(bot.sendToUser).toHaveBeenCalledTimes(1);
      expect(writes).toEqual([]);
    });

    it('ignores a confirmation to an address nobody holds', async () => {
      const { db, queue } = makeDb();
      const bot = makeBot();
      const service = new TestService(db, configWith(CREDENTIALS), bot as never);
      service.mailbox.mockResolvedValue([confirmation(5, '111111111')]);
      queue(users, []);

      await service.ingest(source);

      expect(bot.sendToUser).not.toHaveBeenCalled();
    });

    it('still ingests the alerts that arrived alongside', async () => {
      const { db, queue } = makeDb();
      const service = new TestService(db, configWith(CREDENTIALS), makeBot() as never);
      service.mailbox.mockResolvedValue([
        confirmation(5, '111111111'),
        message(1, '2026-09-29T08:00:00Z'),
      ]);
      queue(users, [tokenUser(null)]);

      await expect(service.ingest(source)).resolves.toEqual({ fetched: 4, upserted: 4 });
    });
  });

  it('lets a mailbox failure propagate so the run is marked error', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS), makeBot() as never);
    service.mailbox.mockRejectedValue(new Error('AUTHENTICATIONFAILED'));
    await expect(service.ingest(source)).rejects.toThrow('AUTHENTICATIONFAILED');
  });
});

describe('collectVacancies', () => {
  it('dates a posting by the earliest email that carried it', () => {
    const rows = collectVacancies(
      [message(2, '2026-09-30T08:00:00Z'), message(1, '2026-09-28T08:00:00Z')],
      source.id,
    );
    expect(rows[0]?.publishedAt).toEqual(new Date('2026-09-28T08:00:00Z'));
  });

  it('carries the alert query into the description', () => {
    const [row] = collectVacancies([message(1, '2026-09-30T08:00:00Z')], source.id);
    expect(row?.description).toContain('senior frontend engineer in European Union');
  });
});

describe('collectAlerts', () => {
  it('maps every job to every user whose email carried it, not only the earliest', () => {
    const { rows, recipients } = collectAlerts(
      [
        message(1, '2026-09-28T08:00:00Z'),
        message(2, '2026-09-29T08:00:00Z', { recipients: ['a'] }),
        message(3, '2026-09-30T08:00:00Z', { recipients: ['b'] }),
      ],
      source.id,
      (m) => (m.recipients[0] === 'a' ? 'user-a' : m.recipients[0] === 'b' ? 'user-b' : null),
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]?.publishedAt).toEqual(new Date('2026-09-28T08:00:00Z'));
    expect([...(recipients.get('4012345678') ?? [])]).toEqual(['user-a', 'user-b']);
    expect(recipients.size).toBe(4);
  });

  it("records nobody for the owner's own alerts", () => {
    const { recipients } = collectAlerts(
      [message(1, '2026-09-28T08:00:00Z')],
      source.id,
      () => null,
    );
    expect(recipients.size).toBe(0);
  });
});
