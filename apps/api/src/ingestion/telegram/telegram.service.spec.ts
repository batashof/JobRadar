import { ConfigService } from '@nestjs/config';
import { TelegramClient } from 'telegram';

import type { Database } from '../../db/db.module';
import type { sources } from '../../db/schema';
import * as vacancyUpsert from '../vacancy-upsert';
import { TelegramIngestService } from './telegram.service';

jest.mock('telegram', () => ({ TelegramClient: jest.fn() }));
jest.mock('telegram/sessions', () => ({ StringSession: jest.fn() }));

const TelegramClientMock = TelegramClient as unknown as jest.Mock;

const source = {
  id: '00000000-0000-0000-0000-000000000002',
  slug: 'telegram',
  config: { channels: ['job_react'], messagesPerChannel: 2 },
  lastRunAt: null,
} as unknown as typeof sources.$inferSelect;

const config = {
  get: (key: string) =>
    ({ TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'hash', TELEGRAM_SESSION: 'session' })[key],
} as unknown as ConfigService;

const post = [
  'Senior React Developer',
  'Company: Acme',
  'Remote, full-time',
  'Stack: React, TypeScript, Next.js',
  'Apply: @acme_hr',
].join('\n');

function fakeClient(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    isUserAuthorized: jest.fn().mockResolvedValue(true),
    getMessages: jest.fn().mockResolvedValue([{ id: 1, message: post, date: 1785224423 }]),
    disconnect: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('TelegramIngestService', () => {
  let upsertMock: jest.SpyInstance;

  beforeEach(() => {
    upsertMock = jest.spyOn(vacancyUpsert, 'upsertVacancies').mockResolvedValue(1);
  });

  afterEach(() => {
    upsertMock.mockRestore();
    TelegramClientMock.mockReset();
  });

  it('destroys the client after a run, so GramJS stops its ping loop', async () => {
    const client = fakeClient();
    TelegramClientMock.mockImplementation(() => client);
    const service = new TelegramIngestService({} as Database, config);

    await service.ingest(source);

    expect(client.getMessages).toHaveBeenCalledWith('job_react', { limit: 2 });
    expect(client.destroy).toHaveBeenCalledTimes(1);
    // A bare disconnect leaves the update loop pinging, timing out and reconnecting.
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('destroys the client when the run fails, too', async () => {
    const client = fakeClient({ getMessages: jest.fn().mockRejectedValue(new Error('FLOOD')) });
    TelegramClientMock.mockImplementation(() => client);
    const service = new TelegramIngestService({} as Database, config);

    await expect(service.ingest(source)).rejects.toThrow('FLOOD');
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not let a failing destroy mask the run result', async () => {
    const destroy = jest.fn().mockRejectedValue(new Error('already closed'));
    const client = fakeClient({ destroy });
    TelegramClientMock.mockImplementation(() => client);
    const service = new TelegramIngestService({} as Database, config);

    await expect(service.ingest(source)).resolves.toMatchObject({ upserted: 1 });
  });

  it('skips without connecting while the secrets are missing', async () => {
    const service = new TelegramIngestService(
      {} as Database,
      { get: () => undefined } as unknown as ConfigService,
    );

    await expect(service.ingest(source)).resolves.toEqual({
      fetched: 0,
      upserted: 0,
      notModified: true,
    });
    expect(TelegramClientMock).not.toHaveBeenCalled();
  });
});
