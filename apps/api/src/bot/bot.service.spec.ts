import type { ConfigService } from '@nestjs/config';

import { BotDialogs } from './bot-dialogs';
import { BotService } from './bot.service';
import { botDialogs, events, telegramAccounts, users } from '../db/schema';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const ok = (result: unknown) =>
  Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, result }) } as Response);
const fail = (errorCode: number, description: string) =>
  Promise.resolve({
    status: errorCode,
    json: () => Promise.resolve({ ok: false, error_code: errorCode, description }),
  } as Response);

const flood = (retryAfter: number) =>
  Promise.resolve({
    status: 429,
    json: () =>
      Promise.resolve({
        ok: false,
        error_code: 429,
        description: `Too Many Requests: retry after ${retryAfter}`,
        parameters: { retry_after: retryAfter },
      }),
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
  const writes: {
    kind: 'insert' | 'update' | 'delete';
    table: unknown;
    values: Record<string, unknown>;
  }[] = [];
  /** Rows `insert ... onConflictDoNothing().returning()` yields, per table. */
  const returning = new Map<unknown, unknown[][]>();

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
      values: (values: Record<string, unknown>) => {
        const record = () => writes.push({ kind: 'insert', table, values });
        return {
          onConflictDoUpdate: () => {
            record();
            return Promise.resolve();
          },
          onConflictDoNothing: () => ({
            returning: () => {
              record();
              return Promise.resolve(returning.get(table)?.shift() ?? []);
            },
          }),
          // A plain `await db.insert(t).values(v)`.
          then: (resolve: (v: unknown) => unknown) => {
            record();
            return Promise.resolve(undefined).then(resolve);
          },
        };
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        writes.push({ kind: 'delete', table, values: {} });
        return Promise.resolve();
      },
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
    /** Scripts what `insert(table)...returning()` yields, in order. */
    inserted: (table: unknown, ...responses: unknown[][]) => returning.set(table, responses),
  };
}

const config = (token?: string) => ({ get: () => token }) as unknown as ConfigService;

const RU_USER = [{ language: 'ru' }];

describe('BotService without a token', () => {
  it('reports itself unconfigured and swallows sends', async () => {
    const { db, writes } = makeDb();
    const bot = new BotService(db, config(undefined), new BotDialogs(db));

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
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

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
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

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
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/start tok-1', chat: { id: 555, type: 'private' } } });

    expect(writes).toHaveLength(0);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).text).toContain('другой аккаунт');
  });

  it('unlinks on /stop', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

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
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await expect(bot.sendToUser('user-1', 'hi')).resolves.toBe('4242');
  });

  it('skips silently when the user is not linked', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, []);
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await expect(bot.sendToUser('user-1', 'hi')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the link when the user has blocked the bot, instead of retrying forever', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ chatId: '555' }], []);
    fetchMock.mockReturnValue(fail(403, 'bot was blocked by the user'));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await expect(bot.sendToUser('user-1', 'hi')).resolves.toBeNull();
    expect(writes[0]).toMatchObject({ table: telegramAccounts, values: { chatId: null } });
  });

  it('waits out a flood limit and retries once, so a long digest loses no card', async () => {
    jest.useFakeTimers();
    try {
      const { db, queue } = makeDb();
      queue(telegramAccounts, [{ chatId: '555' }]);
      fetchMock
        .mockReturnValueOnce(flood(3))
        .mockReturnValueOnce(message(77));
      const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

      const sent = bot.sendToUser('user-1', 'hi');
      await jest.advanceTimersByTimeAsync(3000);

      await expect(sent).resolves.toBe('77');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives up after one retry when the flood limit persists', async () => {
    jest.useFakeTimers();
    try {
      const { db, writes, queue } = makeDb();
      queue(telegramAccounts, [{ chatId: '555' }]);
      fetchMock.mockReturnValue(flood(1));
      const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

      const sent = bot.sendToUser('user-1', 'hi');
      await jest.advanceTimersByTimeAsync(1000);

      await expect(sent).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(writes).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null on any other Telegram failure without unlinking', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ chatId: '555' }]);
    fetchMock.mockReturnValue(fail(400, 'message is too long'));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

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
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
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
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate(press);

    expect(fetchMock.mock.calls[0][0]).toContain('answerCallbackQuery');
  });

  it('answers instead of throwing when the handler blows up', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    bot.registerCallback('n', jest.fn().mockRejectedValue(new Error('boom')));

    await expect(bot.handleUpdate(press)).resolves.toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).text).toContain('Не получилось');
  });

  it('edits the message when the handler asks for it, after answering', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
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
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    bot.registerCallback('n', jest.fn());
    expect(() => bot.registerCallback('n', jest.fn())).toThrow(/already registered/);
  });
});

describe('BotService registration in the bot (ADR-024)', () => {
  const chat = { id: 555, type: 'private' };
  const sentText = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body as string).text as string;

  beforeEach(() => fetchMock.mockReset());

  it('creates an account on a plain /start from a stranger, in the client language', async () => {
    const { db, writes, queue, inserted } = makeDb();
    queue(telegramAccounts, []); // chat not linked
    queue(users, []); // Telegram user unknown
    inserted(users, [{ id: 'new-user' }]);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({
      message: { text: '/start', chat, from: { id: 555, username: 'anna', language_code: 'en-GB' } },
    });

    expect(writes[0]).toMatchObject({
      kind: 'insert',
      table: users,
      values: { telegramUserId: '555', language: 'en', role: 'user' },
    });
    // The account has no email and no password: the chat is the login.
    expect(writes[0]?.values).not.toHaveProperty('email');
    expect(writes[1]).toMatchObject({
      kind: 'insert',
      table: telegramAccounts,
      values: { userId: 'new-user', chatId: '555', username: 'anna' },
    });
    expect(writes[2]).toMatchObject({ table: events, values: { userId: 'new-user', name: 'start' } });
    expect(sentText()).toContain('Welcome to JobRadar');
  });

  it('does nothing more when a racing /start already created the account', async () => {
    const { db, writes, queue, inserted } = makeDb();
    queue(telegramAccounts, []);
    queue(users, []);
    inserted(users, []); // lost the insert to the concurrent update
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/start', chat, from: { id: 555 } } });

    expect(writes.map((w) => w.table)).toEqual([users]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('greets a chat that already has an account instead of creating a second one', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, [{ userId: 'user-1' }], RU_USER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/start', chat, from: { id: 555 } } });

    expect(writes).toHaveLength(0);
    expect(sentText()).toContain('уже привязан');
  });

  it('reconnects a known Telegram user after /stop', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, []); // chat unlinked by /stop
    queue(users, [{ userId: 'user-1' }], RU_USER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/start', chat, from: { id: 555 } } });

    expect(writes).toEqual([
      expect.objectContaining({ kind: 'insert', table: telegramAccounts, values: expect.objectContaining({ userId: 'user-1', chatId: '555' }) }),
    ]);
    expect(sentText()).toContain('С возвращением');
  });

  it('remembers the Telegram user id when a web account links by token', async () => {
    const { db, writes, queue } = makeDb();
    queue(
      telegramAccounts,
      [{ userId: 'user-1', linkTokenExpiresAt: new Date(Date.now() + 60_000) }],
      [],
    );
    queue(users, [], RU_USER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/start tok-1', chat, from: { id: 555 } } });

    expect(writes[1]).toMatchObject({ kind: 'update', table: users, values: { telegramUserId: '555' } });
  });

  it('answers /privacy in the client language when there is no account yet', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, []);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/privacy', chat, from: { id: 555, language_code: 'en' } } });

    expect(sentText()).toContain('What JobRadar stores');
  });
});

describe('BotService account deletion (ADR-024 §8)', () => {
  const press = (data: string) => ({
    callback_query: { id: 'cb-1', data, message: { message_id: 77, chat: { id: 555 } } },
  });

  beforeEach(() => fetchMock.mockReset());

  it('asks for confirmation with two buttons on /delete', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/delete', chat: { id: 555, type: 'private' } } });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain('Удалить аккаунт');
    expect(body.reply_markup.inline_keyboard[0].map((b: { callback_data: string }) => b.callback_data))
      .toEqual(['u:del:y', 'u:del:n']);
    expect(writes).toHaveLength(0);
  });

  it('deletes the account on confirm and keeps an anonymous event', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, [{ language: 'ru', role: 'user' }]);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate(press('u:del:y'));

    expect(writes).toEqual([
      expect.objectContaining({ table: events, values: expect.objectContaining({ name: 'account_deleted' }) }),
      expect.objectContaining({ kind: 'delete', table: users }),
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).text).toContain('удалены');
  });

  it('never deletes the owner account from the chat', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, [{ language: 'ru', role: 'owner' }]);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate(press('u:del:y'));

    expect(writes).toHaveLength(0);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).text).toContain('владельца');
  });

  it('cancels without touching anything', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate(press('u:del:n'));

    expect(writes).toHaveLength(0);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).text).toContain('Ничего не удалено');
  });

  it('passes the account role to feature handlers', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, [{ language: 'en', role: 'owner' }]);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    const handler = jest.fn().mockResolvedValue({});
    bot.registerCallback('n', handler);

    await bot.handleUpdate(press('n:a:x'));

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ role: 'owner', language: 'en' }));
  });
});

describe('BotService messages: dialogs and documents', () => {
  const chat = { id: 555, type: 'private' };
  const later = new Date(Date.now() + 60_000);

  beforeEach(() => fetchMock.mockReset());

  it('hands typed text to the flow that opened the dialog', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, [{ language: 'ru', role: 'user' }]);
    queue(botDialogs, [
      { userId: 'user-1', flow: 'profile', step: 'skills', payload: {}, expiresAt: later },
    ]);
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    const handler = jest.fn().mockResolvedValue(undefined);
    bot.registerDialog('profile', handler);

    await bot.handleUpdate({ message: { text: 'React, Vue', chat, from: { id: 555 } } });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', chatId: '555', role: 'user' }),
      'React, Vue',
      expect.objectContaining({ flow: 'profile', step: 'skills' }),
    );
  });

  it('ignores an expired dialog and says what the bot expects instead', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, [{ language: 'ru', role: 'user' }]);
    queue(botDialogs, [
      { userId: 'user-1', flow: 'profile', step: 'skills', payload: {}, expiresAt: new Date(Date.now() - 1) },
    ]);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    const handler = jest.fn();
    bot.registerDialog('profile', handler);

    await bot.handleUpdate({ message: { text: 'React', chat, from: { id: 555 } } });

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).text).toContain('Пришли резюме в PDF');
  });

  it('routes a document to the registered handler with the account context', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, [{ language: 'en', role: 'user' }]);
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    const handler = jest.fn().mockResolvedValue(undefined);
    bot.registerDocumentHandler(handler);

    await bot.handleUpdate({
      message: { chat, from: { id: 555 }, document: { file_id: 'F1', file_name: 'cv.pdf', mime_type: 'application/pdf' } },
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', language: 'en' }),
      expect.objectContaining({ fileId: 'F1', fileName: 'cv.pdf' }),
    );
  });

  it('asks a stranger who sends a file to press /start first', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, []);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    const handler = jest.fn();
    bot.registerDocumentHandler(handler);

    await bot.handleUpdate({
      message: { chat, from: { id: 555, language_code: 'en' }, document: { file_id: 'F1' } },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).text).toContain('/start');
  });
});
