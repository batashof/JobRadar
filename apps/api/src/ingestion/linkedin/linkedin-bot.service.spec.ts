import type { ConfigService } from '@nestjs/config';

import type { BotMessageContext } from '../../bot/bot.service';
import { users, vacancyRecipients } from '../../db/schema';
import { LinkedInBotService } from './linkedin-bot.service';

/** Fake drizzle: reads queued per `from()` table; updates recorded. */
function makeDb() {
  const queues = new Map<unknown, unknown[][]>();
  const updates: { table: unknown; set: Record<string, unknown> }[] = [];
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
            if (prop === 'from' && table === undefined) table = arg;
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const db = {
    select: () => chain(),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, set });
          return Promise.resolve();
        },
      }),
    }),
  };
  return {
    db: db as never,
    updates,
    queue: (table: unknown, ...responses: unknown[][]) => queues.set(table, responses),
  };
}

const configWith = (env: Record<string, string | undefined>): ConfigService =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

function setup(
  env: Record<string, string | undefined> = {
    ALERTS_IMAP_USER: 'Alerts@Gmail.com',
  },
) {
  const { db, updates, queue } = makeDb();
  const bot = {
    registerCommand: jest.fn(),
    sendToUser: jest.fn().mockResolvedValue('1'),
  };
  const service = new LinkedInBotService(db, configWith(env), bot as never);
  service.onModuleInit();
  const command = bot.registerCommand.mock.calls[0][1] as (c: BotMessageContext) => Promise<void>;
  return { service, bot, updates, queue, command };
}

const ctx: BotMessageContext = {
  userId: 'user-1',
  chatId: '555',
  language: 'en',
  role: 'user',
};

describe('LinkedInBotService', () => {
  it('registers /linkedin', () => {
    const { bot } = setup();
    expect(bot.registerCommand).toHaveBeenCalledWith('linkedin', expect.any(Function));
  });

  it('replies with the existing personal address, the steps and the recent count', async () => {
    const { command, bot, queue, updates } = setup();
    queue(users, [{ token: 'abcdefghijkl' }]);
    queue(vacancyRecipients, [{ n: 3 }]);

    await command(ctx);

    expect(updates).toEqual([]);
    const [userId, text, options] = bot.sendToUser.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(text).toContain('<code>alerts+abcdefghijkl@gmail.com</code>');
    expect(text).toContain('Forwarding and POP/IMAP');
    expect(text).toContain('from:jobalerts-noreply@linkedin.com');
    expect(text).toContain('shown only to you');
    expect(text).toContain('last 14 days: 3');
    expect(options).toEqual({ parseMode: 'HTML' });
  });

  it('creates the token on first use and answers in Russian', async () => {
    const { command, bot, queue, updates } = setup();
    // First read: no token yet; second read: the one just saved.
    queue(users, [{ token: null }], [{ token: 'newtoken2345' }]);

    await command({ ...ctx, language: 'ru' });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(users);
    expect(updates[0]?.set.alertsToken).toMatch(/^[a-z2-7]{12}$/);
    const text = bot.sendToUser.mock.calls[0][1] as string;
    expect(text).toContain('<code>alerts+newtoken2345@gmail.com</code>');
    expect(text).toContain('видишь только ты');
    expect(text).toContain('пришло вакансий: 0');
  });

  it('says the feature is unavailable without a mailbox, creating no token', async () => {
    const { command, bot, updates } = setup({});

    await command(ctx);

    expect(updates).toEqual([]);
    expect(bot.sendToUser).toHaveBeenCalledWith('user-1', expect.stringContaining('unavailable'));
  });

  it('retries once when saving the token fails, then gives up', async () => {
    const { service, queue } = setup();
    queue(users, [{ token: null }]);
    const db = (service as unknown as { db: { update: jest.Mock | (() => unknown) } }).db;
    const update = jest.fn(() => {
      throw new Error('duplicate key');
    });
    db.update = update;

    await expect(service.ensureToken('user-1')).resolves.toBeNull();
    expect(update).toHaveBeenCalledTimes(2);
  });
});
