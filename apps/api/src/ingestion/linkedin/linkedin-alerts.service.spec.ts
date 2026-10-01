import type { ConfigService } from '@nestjs/config';

import type { sources } from '../../db/schema';
import * as vacancyUpsert from '../vacancy-upsert';
import type { AlertMessage } from './alert-mailbox';
import { ALERT_HTML, ALERT_TEXT } from './fixtures';
import { collectVacancies, LinkedInAlertsIngestService } from './linkedin-alerts.service';

const source = {
  id: '00000000-0000-0000-0000-00000000000b',
  slug: 'linkedin',
  config: { senders: ['jobalerts-noreply@linkedin.com'], lookbackDays: 2, maxMessages: 10 },
} as unknown as typeof sources.$inferSelect;

const message = (uid: number, date: string, overrides: Partial<AlertMessage> = {}): AlertMessage => ({
  uid,
  date: new Date(date),
  subject: 'Senior Frontend Engineer at Acme GmbH and more',
  html: ALERT_HTML,
  text: ALERT_TEXT,
  ...overrides,
});

const configWith = (env: Record<string, string | undefined>): ConfigService =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

const CREDENTIALS = { ALERTS_IMAP_USER: 'alerts@example.com', ALERTS_IMAP_PASSWORD: 'app-pass' };

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
    const service = new TestService({} as never, configWith({}));
    await expect(service.ingest(source)).resolves.toEqual({
      fetched: 0,
      upserted: 0,
      notModified: true,
    });
    expect(service.mailbox).not.toHaveBeenCalled();
  });

  it('reads the configured senders over the lookback window, Gmail defaults', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS));
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
      senders: ['jobalerts-noreply@linkedin.com'],
      maxMessages: 10,
    });
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    expect(before - options.since.getTime()).toBeGreaterThanOrEqual(twoDays - 1000);
    expect(before - options.since.getTime()).toBeLessThan(twoDays + 1000);
  });

  it('treats a window without alert emails as not-modified, not as a broken source', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS));
    service.mailbox.mockResolvedValue([]);
    await expect(service.ingest(source)).resolves.toEqual({
      fetched: 0,
      upserted: 0,
      notModified: true,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports emails that yield no jobs as an empty run (layout changed)', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS));
    service.mailbox.mockResolvedValue([
      message(1, '2026-09-30T08:00:00Z', { html: '<p>New look!</p>', text: 'New look!' }),
    ]);
    await expect(service.ingest(source)).resolves.toEqual({ fetched: 0, upserted: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts one row per posting across all emails', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS));
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

  it('lets a mailbox failure propagate so the run is marked error', async () => {
    const service = new TestService({} as never, configWith(CREDENTIALS));
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
