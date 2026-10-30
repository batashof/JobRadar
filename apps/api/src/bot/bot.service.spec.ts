import type { ConfigService } from '@nestjs/config';

import { BotDialogs } from './bot-dialogs';
import { BotService, defaultTimezone } from './bot.service';
import {
  botDialogs,
  digestSettings,
  events,
  plannerSettings,
  reports,
  telegramAccounts,
  users,
} from '../db/schema';

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
  /** `users.last_seen_at` touches (v2.6.0), kept apart so `writes` stays the feature's. */
  const seen: Record<string, unknown>[] = [];
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
        const builder = {
          // A join reads from the `from()` table's queue.
          innerJoin: () => builder,
          where: () => Promise.resolve(rows()),
          then: (resolve: (rows: unknown[]) => unknown, reject?: (err: unknown) => unknown) =>
            Promise.resolve(rows()).then(resolve, reject),
        };
        return builder;
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
            then: (resolve: (v: unknown) => unknown) => {
              record();
              return Promise.resolve(undefined).then(resolve);
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
          if ('lastSeenAt' in values) seen.push(values);
          else writes.push({ kind: 'update', table, values });
          return Promise.resolve();
        },
      }),
    }),
  };

  return {
    db: db as never,
    writes,
    seen,
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
      message: { text: '/start AbCdEfGhIjKlMnOpQrStUvWxYz012345', chat: { id: 555, type: 'private' }, from: { username: 'vlad' } },
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

    await bot.handleUpdate({ message: { text: '/start AbCdEfGhIjKlMnOpQrStUvWxYz012345', chat: { id: 555, type: 'private' } } });

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

  it('swaps only the buttons when the handler gives a keyboard without text', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    const keyboard = [[{ text: 'x', callbackData: 'n:x' }]];
    bot.registerCallback('n', jest.fn().mockResolvedValue({ alert: 'ok', editKeyboard: keyboard }));

    await bot.handleUpdate(press);

    expect(fetchMock.mock.calls[1][0]).toContain('editMessageReplyMarkup');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.reply_markup).toEqual({ inline_keyboard: [[{ text: 'x', callback_data: 'n:x' }]] });
    expect(body.text).toBeUndefined();
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

  it('starts Russian speakers on UTC+3 and everyone else on UTC', () => {
    expect(defaultTimezone('ru')).toBe('Europe/Moscow');
    expect(defaultTimezone('en')).toBe('UTC');
  });

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
    // Delivery settings from the first minute, instant by default (roadmap 5.3).
    expect(writes[2]).toMatchObject({
      table: digestSettings,
      values: { userId: 'new-user', mode: 'instant' },
    });
    expect(writes[3]).toMatchObject({
      table: plannerSettings,
      values: { userId: 'new-user', timezone: 'UTC' },
    });
    expect(writes[4]).toMatchObject({ table: events, values: { userId: 'new-user', name: 'start' } });
    expect(sentText()).toContain('Welcome to JobRadar');
  });

  it('signs up through a shared link and remembers its tag for /stats (v2.6.0)', async () => {
    const { db, writes, queue, inserted } = makeDb();
    queue(telegramAccounts, []);
    queue(users, []);
    inserted(users, [{ id: 'new-user' }]);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/start DOU_chat', chat, from: { id: 555 } } });

    // A tag is not a link token: no "link expired", a new account instead.
    expect(writes[0]).toMatchObject({ kind: 'insert', table: users });
    expect(writes.find((w) => w.table === events)?.values).toMatchObject({
      name: 'start',
      props: { language: 'ru', source: 'dou_chat' },
    });
    expect(sentText()).toContain('Добро пожаловать');
  });

  it('marks the sender as seen, keyed by the Telegram user id (v2.6.0)', async () => {
    const { db, seen, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/help', chat, from: { id: 555 } } });

    expect(seen).toEqual([{ lastSeenAt: expect.any(Date) }]);
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

    await bot.handleUpdate({ message: { text: '/start AbCdEfGhIjKlMnOpQrStUvWxYz012345', chat, from: { id: 555 } } });

    expect(writes[1]).toMatchObject({ kind: 'update', table: users, values: { telegramUserId: '555' } });
  });

  it('answers /privacy in the client language when there is no account yet', async () => {
    const { db, queue } = makeDb();
    queue(telegramAccounts, []);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/privacy', chat, from: { id: 555, language_code: 'en' } } });

    expect(sentText()).toContain('What JobRadar stores');
    // The full policy lives on the landing page (ADR-024 §7).
    expect(sentText()).toContain('https://job-radar-web-phi.vercel.app/privacy');
  });

  it('lists the author tools in /help for the owner only (ADR-024 §3)', async () => {
    const owner = makeDb();
    owner.queue(telegramAccounts, [{ userId: 'user-1' }]);
    owner.queue(users, [{ language: 'en', role: 'owner' }]);
    fetchMock.mockReturnValue(message());
    await new BotService(owner.db, config('123:abc'), new BotDialogs(owner.db)).handleUpdate({
      message: { text: '/help', chat, from: { id: 555 } },
    });
    expect(sentText()).toContain('/stats');
    expect(sentText()).toContain('/settings');
    // Hidden commands (roadmap 5.20) are not advertised, even to the owner.
    for (const hidden of ['/plan', '/gmail', '/applications', '/linkedin', '/noresume']) {
      expect(sentText()).not.toContain(hidden);
    }

    fetchMock.mockClear();
    const user = makeDb();
    user.queue(telegramAccounts, [{ userId: 'user-2' }]);
    user.queue(users, [{ language: 'en', role: 'user' }]);
    await new BotService(user.db, config('123:abc'), new BotDialogs(user.db)).handleUpdate({
      message: { text: '/help', chat, from: { id: 555 } },
    });
    expect(sentText()).toContain('/settings');
    expect(sentText()).not.toContain('/stats');
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
    const sent = fetchMock.mock.calls.map(([url, init]: [string, RequestInit]) => ({
      method: url.split('/').pop(),
      body: JSON.parse(init.body as string),
    }));
    // The chat falls back to the guest menu, /start included (roadmap 5.20).
    expect(sent.find((c) => c.method === 'deleteMyCommands')?.body).toEqual({
      scope: { type: 'chat', chat_id: '555' },
    });
    expect(sent.find((c) => c.method === 'editMessageText')?.body.text).toContain('удалены');
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

describe('BotService test mode (owner walks the new-user flow)', () => {
  const chat = { id: 555, type: 'private' };
  const press = (data: string) => ({
    callback_query: { id: 'cb-1', data, message: { message_id: 77, chat: { id: 555 } } },
  });
  const body = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

  beforeEach(() => fetchMock.mockReset());

  it('asks the owner before parking the account', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'owner-1' }]);
    queue(users, [{ language: 'ru', role: 'owner' }]);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/testmode', chat } });

    expect(body().text).toContain('Тестовый режим');
    expect(body().reply_markup.inline_keyboard[0].map((b: { callback_data: string }) => b.callback_data))
      .toEqual(['u:test:y', 'u:test:n']);
    expect(writes).toHaveLength(0);
  });

  it('is an unknown command for everyone else', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, [{ language: 'ru', role: 'user' }]);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/testmode', chat } });

    expect(body().text).toContain('Неизвестная команда');
    expect(writes).toHaveLength(0);
  });

  it('sets the owner account aside and unlinks the chat, deleting nothing', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'owner-1' }]);
    queue(users, [{ language: 'ru', role: 'owner' }], [{ telegramUserId: '555' }]);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate(press('u:test:y'));

    expect(writes).toEqual([
      expect.objectContaining({ kind: 'update', table: users, values: expect.objectContaining({ telegramUserId: 'testing:555' }) }),
      expect.objectContaining({ kind: 'update', table: telegramAccounts, values: expect.objectContaining({ chatId: null }) }),
    ]);
    expect(writes.some((w) => w.kind === 'delete')).toBe(false);
  });

  it('refuses to park anyone but the owner', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, [{ language: 'ru', role: 'user' }]);
    fetchMock.mockReturnValue(ok(true));
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate(press('u:test:y'));

    expect(writes).toHaveLength(0);
  });

  it('signs up a test account instead of bringing the owner back', async () => {
    const { db, writes, queue, inserted } = makeDb();
    queue(telegramAccounts, []); // the chat was unlinked by /testmode
    queue(users, [], [{ userId: 'owner-1' }]); // no account for 555, the owner waiting under testing:555
    inserted(users, [{ id: 'test-1' }]);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/start', chat, from: { id: 555 } } });

    expect(writes[0]).toEqual(
      expect.objectContaining({ kind: 'update', table: users, values: expect.objectContaining({ telegramUserId: 'parked:555' }) }),
    );
    expect(writes[1]).toEqual(
      expect.objectContaining({ kind: 'insert', table: users, values: expect.objectContaining({ telegramUserId: '555', role: 'user' }) }),
    );
    expect(body().text).toContain('Добро пожаловать');
  });
  it('brings the parked owner back on /start once the test account is deleted', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, []); // chat unlinked: the test account was deleted
    queue(users, [], [], [{ userId: 'owner-1' }], RU_USER); // no account for 555, no test waiting, the parked one, its language
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.handleUpdate({ message: { text: '/start', chat, from: { id: 555 } } });

    expect(writes).toEqual([
      expect.objectContaining({ kind: 'update', table: users, values: expect.objectContaining({ telegramUserId: '555' }) }),
      expect.objectContaining({ kind: 'insert', table: telegramAccounts, values: expect.objectContaining({ userId: 'owner-1', chatId: '555' }) }),
    ]);
    expect(body().text).toContain('аккаунту владельца');
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
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).text).toContain('Пришли резюме файлом PDF');
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

describe('BotService error reports (v2.6.0)', () => {
  beforeEach(() => fetchMock.mockReset());
  const OWNER = [{ chatId: '42', language: 'ru' }];

  it('counts the error and tells the owner once per window', async () => {
    const { db, writes, queue } = makeDb();
    queue(users, OWNER, OWNER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    const t0 = Date.parse('2026-10-19T10:00:00Z');
    await bot.reportError('/resume', new Error('pdf broken'), 'user-1', t0);
    await bot.reportError('/resume', new Error('pdf broken'), 'user-1', t0 + 60_000);

    // Both land in events for /stats, with no message text beyond the error.
    const errors = writes.filter((w) => w.table === events);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.values).toMatchObject({
      userId: 'user-1',
      name: 'error',
      props: { where: '/resume', message: 'pdf broken' },
    });
    // Only the first reaches the owner's chat.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.chat_id).toBe('42');
    expect(body.text).toContain('Ошибка в боте: /resume');
    expect(body.text).toContain('pdf broken');
    expect(body.text).toContain('user-1');
  });

  it('alerts again once the window has passed', async () => {
    const { db, queue } = makeDb();
    queue(users, OWNER, OWNER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    const t0 = Date.parse('2026-10-19T10:00:00Z');
    await bot.reportError('/digest', new Error('x'), null, t0);
    await bot.reportError('/digest', new Error('x'), null, t0 + 31 * 60_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a failing command with its label instead of only logging it', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }], [{ userId: 'user-1' }]);
    queue(users, [{ language: 'ru', role: 'user' }], OWNER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    bot.registerCommand('boom', () => Promise.reject(new Error('kaput')));

    await bot.handleUpdate({ message: { text: '/boom', chat: { id: 555, type: 'private' }, from: { id: 555 } } });

    expect(writes.find((w) => w.table === events)?.values).toMatchObject({
      name: 'error',
      props: { where: '/boom', message: 'kaput' },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).text).toContain('/boom');
  });
});

describe('BotService transient faults and callback answers (ADR-037)', () => {
  beforeEach(() => fetchMock.mockReset());
  const OWNER = [{ chatId: '42', language: 'ru' }];
  const press = {
    callback_query: { id: 'cb-1', data: 's:open', message: { message_id: 77, chat: { id: 555 } } },
  };

  it('keeps a network fault in the inbox without alerting the owner', async () => {
    const { db, writes, queue } = makeDb();
    queue(users, OWNER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.reportError('button s:open', new Error('answerCallbackQuery failed: fetch failed'), 'user-1');

    expect(writes.find((w) => w.table === events)).toBeDefined();
    expect(writes.find((w) => w.table === reports)?.values).toMatchObject({
      kind: 'error',
      title: 'button s:open',
      transient: true,
      fingerprint: 'error:button s:open|answerCallbackQuery failed: fetch failed',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('puts a real failure in the inbox and still alerts at once', async () => {
    const { db, writes, queue } = makeDb();
    queue(users, OWNER);
    fetchMock.mockReturnValue(message());
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.reportError('/resume', new TypeError("Cannot read properties of undefined (reading 'x')"));

    expect(writes.find((w) => w.table === reports)?.values).toMatchObject({ transient: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still redraws the screen when answering the press fails on the network', async () => {
    const { db, writes, queue } = makeDb();
    queue(telegramAccounts, [{ userId: 'user-1' }]);
    queue(users, RU_USER);
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    bot.registerCallback('s', () => Promise.resolve({ editText: 'Настройки', editKeyboard: [] }));
    // Both tries of the answer fail (the client retries an idempotent call
    // once), then the edit goes through.
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockReturnValue(ok(true));

    await bot.handleUpdate(press);

    const methods = fetchMock.mock.calls.map((call) => String(call[0]).split('/').pop());
    expect(methods).toEqual(['answerCallbackQuery', 'answerCallbackQuery', 'editMessageText']);
    // Nothing failed from the user's side, so nothing is reported.
    expect(writes.filter((w) => w.table === events || w.table === reports)).toHaveLength(0);
  });
});
