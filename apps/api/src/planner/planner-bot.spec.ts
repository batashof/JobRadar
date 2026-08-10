import type { ConfigService } from '@nestjs/config';

import type { BotCallbackContext } from '../bot/bot.service';
import { planBlocks, plannerNudges, users } from '../db/schema';
import { PlannerBotService } from './planner-bot.service';

/** Same shape as the bot's fake: one scripted response per `from(table)` call. */
function makeDb() {
  const queues = new Map<unknown, unknown[][]>();
  const db = {
    select: () => ({
      from: (table: unknown) => {
        let cached: unknown[] | undefined;
        const rows = () => (cached ??= queues.get(table)?.shift() ?? []);
        return { where: () => Promise.resolve(rows()) };
      },
    }),
  };
  return {
    db: db as never,
    queue: (table: unknown, ...responses: unknown[][]) => queues.set(table, responses),
  };
}

const config = (webOrigin?: string) => ({ get: () => webOrigin }) as unknown as ConfigService;

const makeBot = (configured = true) => ({
  isConfigured: () => configured,
  sendToUser: jest.fn().mockResolvedValue('4242'),
  registerCallback: jest.fn(),
});

const makePlanner = () => ({
  startBlock: jest.fn().mockResolvedValue(undefined),
  completeBlock: jest.fn().mockResolvedValue(undefined),
  acknowledgeNudge: jest.fn().mockResolvedValue([]),
});

const nudge = (over: Partial<Parameters<PlannerBotService['deliver']>[0]> = {}) => ({
  id: 'nudge-1',
  userId: 'user-1',
  kind: 'morning' as const,
  blockId: null,
  repeatIndex: 0,
  ...over,
});

const ctx = (parts: string[]): BotCallbackContext => ({
  userId: 'user-1',
  chatId: '555',
  messageId: 77,
  parts,
  language: 'ru',
});

/** Grabs the callback the service registered with the bot on init. */
function register(service: PlannerBotService, bot: ReturnType<typeof makeBot>) {
  service.onModuleInit();
  return bot.registerCallback.mock.calls[0][1] as (c: BotCallbackContext) => Promise<unknown>;
}

describe('PlannerBotService.deliver', () => {
  it('does nothing when the user has the channel off', async () => {
    const { db } = makeDb();
    const bot = makeBot();
    const service = new PlannerBotService(db, bot as never, makePlanner() as never, config());

    await expect(service.deliver(nudge(), false)).resolves.toBeNull();
    expect(bot.sendToUser).not.toHaveBeenCalled();
  });

  it('does nothing when no bot token is configured', async () => {
    const { db } = makeDb();
    const bot = makeBot(false);
    const service = new PlannerBotService(db, bot as never, makePlanner() as never, config());

    await expect(service.deliver(nudge(), true)).resolves.toBeNull();
    expect(bot.sendToUser).not.toHaveBeenCalled();
  });

  it('sends a day-scoped nudge with an ack button and a link into the app', async () => {
    const { db, queue } = makeDb();
    queue(users, [{ language: 'ru' }]);
    const bot = makeBot();
    const service = new PlannerBotService(
      db,
      bot as never,
      makePlanner() as never,
      config('https://job-radar.test/'),
    );

    await expect(service.deliver(nudge(), true)).resolves.toBe('4242');

    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('День ещё не принят');
    expect(options.keyboard).toEqual([
      [
        { text: 'Понял', callbackData: 'n:a:nudge-1' },
        // Trailing slash on WEB_ORIGIN must not produce a double slash.
        { text: 'Открыть', url: 'https://job-radar.test/app/day' },
      ],
    ]);
  });

  it('offers Start/Skip on a block nudge and names the block', async () => {
    const { db, queue } = makeDb();
    queue(users, [{ language: 'ru' }]);
    queue(planBlocks, [{ title: 'Откликнуться: Acme', estimate: 45, actual: 0 }]);
    const bot = makeBot();
    const service = new PlannerBotService(db, bot as never, makePlanner() as never, config());

    await service.deliver(nudge({ kind: 'block_start', blockId: 'block-1' }), true);

    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('Откликнуться: Acme — 45 мин');
    expect(options.keyboard).toEqual([
      [
        { text: 'Начать', callbackData: 'n:s:nudge-1' },
        { text: 'Пропустить', callbackData: 'n:k:nudge-1' },
      ],
    ]);
  });

  it('offers Done/Skip on a midway nudge and shows time spent against the estimate', async () => {
    const { db, queue } = makeDb();
    queue(users, [{ language: 'en' }]);
    queue(planBlocks, [{ title: 'Deep work', estimate: 30, actual: 55 }]);
    const bot = makeBot();
    const service = new PlannerBotService(db, bot as never, makePlanner() as never, config());

    await service.deliver(nudge({ kind: 'midway', blockId: 'block-1' }), true);

    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('Deep work — 55 / 30 min');
    expect(options.keyboard[0].map((b: { text: string }) => b.text)).toEqual(['Done', 'Skip']);
  });

  it('marks a repeat so an escalation does not read as a new nudge', async () => {
    const { db, queue } = makeDb();
    queue(users, [{ language: 'ru' }]);
    const bot = makeBot();
    const service = new PlannerBotService(db, bot as never, makePlanner() as never, config());

    await service.deliver(nudge({ kind: 'escalation', repeatIndex: 1 }), true);

    expect(bot.sendToUser.mock.calls[0][1]).toContain('Напоминание 2');
  });

  it('escapes markup in a user-typed block title', async () => {
    const { db, queue } = makeDb();
    queue(users, [{ language: 'ru' }]);
    queue(planBlocks, [{ title: '<b>hack</b> & co', estimate: 30, actual: 0 }]);
    const bot = makeBot();
    const service = new PlannerBotService(db, bot as never, makePlanner() as never, config());

    await service.deliver(nudge({ kind: 'block_start', blockId: 'block-1' }), true);

    expect(bot.sendToUser.mock.calls[0][1]).toContain('&lt;b&gt;hack&lt;/b&gt; &amp; co');
  });
});

describe('PlannerBotService buttons', () => {
  const sentNudge = (kind = 'block_start') => [
    { id: 'nudge-1', kind, blockId: 'block-1', status: 'sent' },
  ];

  it('registers itself under the nudge namespace', () => {
    const { db } = makeDb();
    const bot = makeBot();
    new PlannerBotService(db, bot as never, makePlanner() as never, config()).onModuleInit();
    expect(bot.registerCallback).toHaveBeenCalledWith('n', expect.any(Function));
  });

  it('starts the block, acknowledges the nudge and strips the buttons', async () => {
    const { db, queue } = makeDb();
    queue(plannerNudges, sentNudge());
    const bot = makeBot();
    const planner = makePlanner();
    const handler = register(
      new PlannerBotService(db, bot as never, planner as never, config()),
      bot,
    );

    const result = (await handler(ctx(['n', 's', 'nudge-1']))) as {
      alert: string;
      editKeyboard: null;
    };

    expect(planner.startBlock).toHaveBeenCalledWith('user-1', 'block-1');
    expect(planner.acknowledgeNudge).toHaveBeenCalledWith('user-1', 'nudge-1');
    expect(result.alert).toBe('Запущено');
    expect(result.editKeyboard).toBeNull();
  });

  it('completes the block on Done', async () => {
    const { db, queue } = makeDb();
    queue(plannerNudges, sentNudge('midway'));
    const bot = makeBot();
    const planner = makePlanner();
    const handler = register(
      new PlannerBotService(db, bot as never, planner as never, config()),
      bot,
    );

    await handler(ctx(['n', 'd', 'nudge-1']));

    expect(planner.completeBlock).toHaveBeenCalledWith('user-1', 'block-1', { status: 'done' });
  });

  it('records a reason when a block is skipped from the phone', async () => {
    const { db, queue } = makeDb();
    queue(plannerNudges, sentNudge());
    const bot = makeBot();
    const planner = makePlanner();
    const handler = register(
      new PlannerBotService(db, bot as never, planner as never, config()),
      bot,
    );

    await handler(ctx(['n', 'k', 'nudge-1']));

    // A skip without a reason would be rejected by the planner (ADR-015 §4).
    expect(planner.completeBlock).toHaveBeenCalledWith('user-1', 'block-1', {
      status: 'skipped',
      reason: 'no_time',
    });
  });

  it('acknowledges a day-scoped nudge without touching any block', async () => {
    const { db, queue } = makeDb();
    queue(plannerNudges, [{ id: 'nudge-1', kind: 'morning', blockId: null, status: 'sent' }]);
    const bot = makeBot();
    const planner = makePlanner();
    const handler = register(
      new PlannerBotService(db, bot as never, planner as never, config()),
      bot,
    );

    await handler(ctx(['n', 'a', 'nudge-1']));

    expect(planner.startBlock).not.toHaveBeenCalled();
    expect(planner.completeBlock).not.toHaveBeenCalled();
    expect(planner.acknowledgeNudge).toHaveBeenCalledWith('user-1', 'nudge-1');
  });

  it('does not re-acknowledge a nudge already resolved in the app', async () => {
    const { db, queue } = makeDb();
    queue(plannerNudges, [
      { id: 'nudge-1', kind: 'block_start', blockId: 'block-1', status: 'acknowledged' },
    ]);
    const bot = makeBot();
    const planner = makePlanner();
    const handler = register(
      new PlannerBotService(db, bot as never, planner as never, config()),
      bot,
    );

    await handler(ctx(['n', 's', 'nudge-1']));

    expect(planner.startBlock).toHaveBeenCalled();
    expect(planner.acknowledgeNudge).not.toHaveBeenCalled();
  });

  it('answers a press on a nudge that no longer exists instead of acting on it', async () => {
    const { db, queue } = makeDb();
    queue(plannerNudges, []);
    const bot = makeBot();
    const planner = makePlanner();
    const handler = register(
      new PlannerBotService(db, bot as never, planner as never, config()),
      bot,
    );

    const result = (await handler(ctx(['n', 's', 'nudge-1']))) as { editKeyboard: null };

    expect(planner.startBlock).not.toHaveBeenCalled();
    expect(result.editKeyboard).toBeNull();
  });

  it('ignores malformed callback data', async () => {
    const { db } = makeDb();
    const bot = makeBot();
    const planner = makePlanner();
    const handler = register(
      new PlannerBotService(db, bot as never, planner as never, config()),
      bot,
    );

    await handler(ctx(['n']));

    expect(planner.startBlock).not.toHaveBeenCalled();
    expect(planner.acknowledgeNudge).not.toHaveBeenCalled();
  });
});
