import type { ConfigService } from '@nestjs/config';

import { BotService } from './bot.service';
import { telegramAccounts, users } from '../db/schema';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const ok = (result: unknown) =>
  Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, result }) } as Response);
const fail = (errorCode: number, description: string) =>
  Promise.resolve({
    status: errorCode,
    json: () => Promise.resolve({ ok: false, error_code: errorCode, description }),
  } as Response);

const message = (id = 1) => ok({ message_id: id, chat: { id: 99 } });
const getMe = () => ok({ id: 7, username: 'JobRadarBot' });

/**
 * Fake drizzle: `select` answers from a per-table queue (each call shifts one
 * response, so a service that reads the same table twice for different reasons
 * can be scripted), while writes are recorded for assertions.
 */
function makeDb() {
  const queues = new Map<unknown, unknown[][]>();
  const writes: { kind: 'insert' | 'update'; table: unknown; values: Record<string, unknown> }[] = [];

  const next = (table: unknown): unknown[] => queues.get(table)?.shift() ?? [];

  const db = {
    select: () => ({
      from: (table: unknown) => {
        // One `from()` consumes exactly one scripted response, whether the
        // caller finishes with `.where()` or awaits the builder directly.
        let cached: unknown[] | undefined;
        const rows = () => (cached ??= next(table));
        return {
          where: () => Promise.resolve(rows()),
          then: (resolve: (rows: unknown[]) => unknown, reject?: (err: unknown) => unknown) =>
            Promise.resolve(rows()).then(resolve, reject),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: () => {
          writes.push({ kind: 'insert', table, values });
          return Promise.resolve();
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          writes.push({ kind: 'update', table, values });
          return Promise.resolve();
        },
      }),
    }),
  };

  return {
    db: db as never,
    writes,
    /** Scripts the responses `select ... from(table)` returns, in order. */
    queue: (table: unknown, ...responses: unknown[][]) => queues.set(table, responses),
  };
}

const config = (token?: string) => ({ get: () => token }) as unknown as ConfigService;

const RU_USER = [{ language: 'ru' }];

describe('BotService without a token', () => {
  it('reports itself unconfigured and swallows sends', async () => {
    const { db, writes } = makeDb();
    const bot = new BotService(db, config(undefined));

    expect(bot.isConfigured()).toBe(false);
    await expect(bot.sendToUser('user-1', 'hi')).resolves.toBeNull();
    await expect(bot.handleUpdate({ message: { text: '/help', chat: { id: 1, type: 'private' } } }))
      .resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe('BotService linking', () => {
  beforeEach(() => fetchMock.mockReset());

  it('issues a single-use deep link and stores the token', async () => {
    const { db, writes } = makeDb();
    fetchMock.mockReturnValueOnce(getMe());
    const bot = new BotService(db, config('123:abc'));

    const link = await bot.startLink('user-1');

    expect(link.deepLink).toMatch(/^https:\/\/t\.me\/JobRadarBot\?start=[\w-]{32,}$/);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(writes[0]).toMatchObject({ kind: 'insert', table: telegramAccounts });
    expect(writes[0]?.values.linkToken).toEqual(expect.any(String));
  });

  it('completes the link on /start <token> and confirms in the account language', async () => {
    const { db, writes, queue } = makeDb();
    const expiresAt = new Date(Date.now() + 60_000);
    queue(
      telegramAccounts,
      [{ userId: 'user-1', linkTokenExpiresAt: expiresAt }], // token lookup
      [], // chat is not linked to anyone yet
    );
    queue(users, RU_USER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'));

    await bot.handleUpdate({
      message: { text: '/start tok-1', chat: { id: 555, type: 'private' }, from: { username: 'vlad' } },
    });

    expect(writes[0]).toMatchObject({
      kind: 'update',
      table: telegramAccounts,
      values: { chatId: '555', username: 'vlad', linkToken: null },
    });
    const reply = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reply.text).toContain('Подключено');
  });

  it('refuses a token whose chat already belongs to someone else', async () => {
    const { db, writes, queue } = makeDb();
    queue(
      telegramAccounts,
      [{ userId: 'user-1', linkTokenExpiresAt: new Date(Date.now() + 60_000) }],
      [{ userId: 'user-2' }], // chat already linked elsewhere
    );
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'));

    await bot.handleUpdate({ message: { text: '/start tok-1', chat: { id: 555, type: 'private' } } });

    expect(writes).toHaveLength(0);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).text).toContain('другому аккаунту');
  });

  it('unlinks on /stop', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'));

    await bot.handleUpdate({ message: { text: '/stop', chat: { id: 555, type: 'private' } } });

    expect(writes[0]).toMatchObject({ values: { chatId: null, linkedAt: null } });
  });
});

describe('BotService delivery', () => {
  beforeEach(() => fetchMock.mockReset());

  it('sends to the linked chat and returns the message id', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ chatId: '555' }]);
    fetchMock.mockReturnValue(message(4242));
    const bot = new BotService(db, config('123:abc'));

    await expect(bot.sendToUser('user-1', 'hi')).resolves.toBe('4242');
  });

  it('skips silently when the user is not linked', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, []);
    const bot = new BotService(db, config('123:abc'));

    await expect(bot.sendToUser('user-1', 'hi')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the link when the user has blocked the bot, instead of retrying forever', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ chatId: '555' }], []);
    fetchMock.mockReturnValue(fail(403, 'bot was blocked by the user'));
    const bot = new BotService(db, config('123:abc'));

    await expect(bot.sendToUser('user-1', 'hi')).resolves.toBeNull();
    expect(writes[0]).toMatchObject({ table: telegramAccounts, values: { chatId: null } });
  });

  it('returns null on any other Telegram failure without unlinking', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ chatId: '555' }]);
    fetchMock.mockReturnValue(fail(400, 'message is too long'));
    const bot = new BotService(db, config('123:abc'));

    await expect(bot.sendToUser('user-1', 'hi')).resolves.toBeNull();
    expect(writes).toHaveLength(0);
  });
});

describe('BotService callbacks', () => {
  const press = {
    callback_query: {
      id: 'cb-1',
      data: 'n:a:nudge-1',
      message: { message_id: 77, chat: { id: 555 } },
    },
  };

  beforeEach(() => fetchMock.mockReset());

  it('routes a press to the handler registered for its namespace', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'));
    const handler = jest.fn().mockResolvedValue({ alert: 'Принято' });
    bot.registerCallback('n', handler);

    await bot.handleUpdate(press);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', chatId: '555', messageId: 77, language: 'ru' }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      callback_query_id: 'cb-1',
      text: 'Принято',
    });
  });

  it('answers a press from an unknown namespace instead of leaving a spinner', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'));

    await bot.handleUpdate(press);

    expect(fetchMock.mock.calls[0][0]).toContain('answerCallbackQuery');
  });

  it('answers instead of throwing when the handler blows up', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'));
    bot.registerCallback('n', jest.fn().mockRejectedValue(new Error('boom')));

    await expect(bot.handleUpdate(press)).resolves.toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).text).toContain('Не получилось');
  });

  it('edits the message when the handler asks for it, after answering', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'));
    bot.registerCallback('n', jest.fn().mockResolvedValue({ editText: 'done', editKeyboard: null }));

    await bot.handleUpdate(press);

    expect(fetchMock.mock.calls[0][0]).toContain('answerCallbackQuery');
    expect(fetchMock.mock.calls[1][0]).toContain('editMessageText');
    // A null keyboard strips the buttons rather than leaving stale ones behind.
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).reply_markup).toEqual({
      inline_keyboard: [],
    });
  });

  it('refuses to register two handlers for one namespace', () => {
    const { db } = makeDb();
    const bot = new BotService(db, config('123:abc'));
    bot.registerCallback('n', jest.fn());
    expect(() => bot.registerCallback('n', jest.fn())).toThrow(/already registered/);
  });
});
