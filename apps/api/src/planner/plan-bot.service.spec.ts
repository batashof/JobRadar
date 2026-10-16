import type { DayPlanDetail, PlanBlockItem, PlannerTodayResponse } from '@jobradar/shared';

import type { OpenDialog } from '../bot/bot-dialogs';
import type { BotCallbackContext, BotCallbackResult, BotMessageContext } from '../bot/bot.service';
import { PlanBotService } from './plan-bot.service';

const BLOCK = '11111111-2222-4333-8444-555555555555';

function block(over: Partial<PlanBlockItem> = {}): PlanBlockItem {
  return {
    id: BLOCK,
    position: 0,
    title: 'Follow up: Acme',
    details: null,
    category: 'job_search',
    sourceKind: 'manual',
    sourceRef: null,
    estimateMinutes: 30,
    correctedEstimateMinutes: 30,
    actualMinutes: 0,
    status: 'pending',
    skipReason: null,
    outcomeNote: null,
    carriedFromBlockId: null,
    carryCount: 0,
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

function plan(over: Partial<DayPlanDetail> = {}): DayPlanDetail {
  return {
    id: 'plan-1',
    planDate: '2026-10-16',
    status: 'draft',
    generatedBy: 'llm',
    intent: null,
    acceptedAt: null,
    closedAt: null,
    autoClosed: false,
    review: null,
    blocks: [block()],
    activeSession: null,
    ...over,
  };
}

function today(p: DayPlanDetail | null): PlannerTodayResponse {
  return {
    today: '2026-10-16',
    plan: p,
    settings: { capacityMinutes: 240, defaultBlockMinutes: 30 } as PlannerTodayResponse['settings'],
    nudges: [],
  };
}

function setup(initial: DayPlanDetail | null = plan()) {
  const bot = {
    registerCommand: jest.fn(),
    registerCallback: jest.fn(),
    registerDialog: jest.fn(),
    sendToUser: jest.fn().mockResolvedValue('1'),
    editMessage: jest.fn().mockResolvedValue(undefined),
  };
  const dialogs = {
    open: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const planner = {
    getToday: jest.fn().mockResolvedValue(today(initial)),
    generatePlan: jest.fn().mockResolvedValue(plan()),
    acceptPlan: jest.fn().mockResolvedValue(plan({ status: 'accepted' })),
    closePlan: jest.fn().mockResolvedValue(plan({ status: 'closed' })),
    addBlock: jest.fn().mockResolvedValue(plan()),
    startBlock: jest.fn().mockResolvedValue(plan()),
    pauseBlock: jest.fn().mockResolvedValue(plan()),
    completeBlock: jest.fn().mockResolvedValue(plan()),
    dropBlock: jest.fn().mockResolvedValue(plan()),
  };
  const service = new PlanBotService(bot as never, dialogs as never, planner as never);
  service.onModuleInit();
  const command = bot.registerCommand.mock.calls[0][1] as (
    c: BotMessageContext,
    arg: string,
  ) => Promise<void>;
  const callback = bot.registerCallback.mock.calls[0][1] as (
    c: BotCallbackContext,
  ) => Promise<BotCallbackResult>;
  const typed = bot.registerDialog.mock.calls[0][1] as (
    c: BotMessageContext,
    text: string,
    d: OpenDialog,
  ) => Promise<void>;
  return { bot, dialogs, planner, command, callback, typed };
}

const owner: BotMessageContext = { userId: 'user-1', chatId: '555', language: 'en', role: 'owner' };
const user: BotMessageContext = { ...owner, role: 'user', language: 'ru' };
const press = (ctx: BotMessageContext, ...parts: string[]): BotCallbackContext => ({
  ...ctx,
  messageId: 9,
  parts,
});
const dialog: OpenDialog = { userId: 'user-1', flow: 'plan', step: 'add', payload: {} };

describe('PlanBotService', () => {
  it('registers /plan, the l namespace and the plan dialog', () => {
    const { bot } = setup();
    expect(bot.registerCommand).toHaveBeenCalledWith('plan', expect.any(Function));
    expect(bot.registerCallback).toHaveBeenCalledWith('l', expect.any(Function));
    expect(bot.registerDialog).toHaveBeenCalledWith('plan', expect.any(Function));
  });

  describe('owner gate', () => {
    it('answers /plan for a non-owner with a short note in their language', async () => {
      const { command, bot, planner } = setup();
      await command(user, '');
      expect(planner.getToday).not.toHaveBeenCalled();
      expect(bot.sendToUser).toHaveBeenCalledWith(
        'user-1',
        expect.stringContaining('только автору'),
      );
    });

    it('refuses buttons and typed blocks from a non-owner', async () => {
      const { callback, typed, planner, bot, dialogs } = setup();
      const result = await callback(press(user, 'l', 'g'));
      expect(result.alert).toContain('только автору');
      expect(planner.generatePlan).not.toHaveBeenCalled();

      await typed(user, 'Something, 30', dialog);
      expect(planner.addBlock).not.toHaveBeenCalled();
      expect(dialogs.close).toHaveBeenCalledWith('555');
      expect(bot.sendToUser).toHaveBeenCalledWith(
        'user-1',
        expect.stringContaining('только автору'),
      );
    });
  });

  it('sends today’s plan for /plan', async () => {
    const { command, bot, dialogs } = setup();
    await command(owner, '');
    expect(dialogs.close).toHaveBeenCalledWith('555');
    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('Follow up: Acme');
    expect(options.parseMode).toBe('HTML');
    expect(options.keyboard[0][0].callbackData).toBe(`l:o:${BLOCK}`);
  });

  describe('compose and accept', () => {
    it('shows "thinking" first, then the draft with Accept / Regenerate', async () => {
      const { callback, bot, planner } = setup(null);
      const result = await callback(press(owner, 'l', 'g'));

      expect(bot.editMessage).toHaveBeenCalledWith('555', 9, expect.stringContaining('Composing'), {
        parseMode: 'HTML',
        keyboard: [],
      });
      expect(planner.generatePlan).toHaveBeenCalledWith('user-1', 'en', { regenerate: false });
      expect(result.alert).toBe('Draft ready');
      expect(result.editText).toContain('Follow up: Acme');
      const data = result.editKeyboard!.flat().map((b) => b.callbackData);
      expect(data).toEqual(expect.arrayContaining(['l:a', 'l:r']));
    });

    it('regenerates an existing draft and explains a fallback composition', async () => {
      const { callback, planner } = setup();
      planner.generatePlan.mockResolvedValue(plan({ generatedBy: 'fallback' }));
      const result = await callback(press(owner, 'l', 'r'));
      expect(planner.generatePlan).toHaveBeenCalledWith('user-1', 'en', { regenerate: true });
      expect(result.editText).toContain('AI was unavailable');
    });

    it('offers a retry when composing fails', async () => {
      const { callback, planner } = setup(null);
      planner.generatePlan.mockRejectedValue(new Error('LLM down'));
      const result = await callback(press(owner, 'l', 'g'));
      expect(result.editText).toContain('Could not compose the plan');
      expect(result.editKeyboard!.flat().map((b) => b.callbackData)).toEqual(['l:g', 'l:n', 'l:v']);
    });

    it('accepts today’s plan', async () => {
      const { callback, planner } = setup();
      planner.getToday
        .mockResolvedValueOnce(today(plan()))
        .mockResolvedValueOnce(today(plan({ status: 'accepted' })));
      const result = await callback(press(owner, 'l', 'a'));
      expect(planner.acceptPlan).toHaveBeenCalledWith('user-1', 'plan-1');
      expect(result.alert).toBe('Accepted');
      expect(result.editText).toContain('taken on');
    });
  });

  describe('block actions', () => {
    it('opens a block card', async () => {
      const { callback } = setup();
      const result = await callback(press(owner, 'l', 'o', BLOCK));
      expect(result.editKeyboard!.flat().map((b) => b.text)).toEqual([
        '▶️ Start',
        '✅ Done',
        '🗑 Delete',
        '⬅️ Back',
      ]);
    });

    it('starts a block and re-renders its card', async () => {
      const { callback, planner } = setup();
      planner.getToday
        .mockResolvedValueOnce(today(plan()))
        .mockResolvedValueOnce(today(plan({ blocks: [block({ status: 'active' })] })));
      const result = await callback(press(owner, 'l', 's', BLOCK));
      expect(planner.startBlock).toHaveBeenCalledWith('user-1', BLOCK);
      expect(result.alert).toBe('Started');
      expect(result.editKeyboard!.flat().map((b) => b.text)).toEqual([
        '⏸ Pause',
        '✅ Done',
        '⬅️ Back',
      ]);
    });

    it('pauses, completes and drops through the planner', async () => {
      const { callback, planner } = setup();
      await callback(press(owner, 'l', 'p', BLOCK));
      expect(planner.pauseBlock).toHaveBeenCalledWith('user-1', BLOCK);

      const done = await callback(press(owner, 'l', 'd', BLOCK));
      expect(planner.completeBlock).toHaveBeenCalledWith('user-1', BLOCK, { status: 'done' });
      expect(done.alert).toBe('Done');

      const dropped = await callback(press(owner, 'l', 'x', BLOCK));
      expect(planner.dropBlock).toHaveBeenCalledWith('user-1', BLOCK, {
        reason: 'changed_priority',
      });
      expect(dropped.alert).toBe('Deleted');
    });

    it('re-renders the plan when the block is gone', async () => {
      const { callback, planner } = setup(plan({ blocks: [] }));
      const result = await callback(press(owner, 'l', 's', BLOCK));
      expect(planner.startBlock).not.toHaveBeenCalled();
      expect(result.alert).toContain('not in today');
    });

    it('turns a planner error into the current plan with a toast', async () => {
      const { callback, planner } = setup();
      planner.startBlock.mockRejectedValue(new Error('This day is already closed'));
      const result = await callback(press(owner, 'l', 's', BLOCK));
      expect(result.alert).toContain('plan has changed');
      expect(result.editText).toContain('Follow up: Acme');
    });
  });

  describe('close the day', () => {
    it('asks first, then closes and shows the result', async () => {
      const { callback, planner } = setup();
      const ask = await callback(press(owner, 'l', 'c'));
      expect(ask.editText).toContain('Close the day?');
      expect(planner.closePlan).not.toHaveBeenCalled();

      planner.getToday.mockResolvedValueOnce(today(plan())).mockResolvedValueOnce(
        today(
          plan({
            status: 'closed',
            review: {
              completedBlocks: 2,
              totalBlocks: 3,
              plannedMinutes: 90,
              actualMinutes: 80,
              minutesByCategory: {},
              debtCreated: 1,
            },
          }),
        ),
      );
      const closed = await callback(press(owner, 'l', 'z'));
      expect(planner.closePlan).toHaveBeenCalledWith('user-1', 'plan-1', {});
      expect(closed.editText).toContain('Day closed');
      expect(closed.editText).toContain('2 of 3 blocks done');
      expect(closed.editKeyboard).toEqual([]);
    });
  });

  describe('add a block', () => {
    it('opens the dialog with a prompt', async () => {
      const { callback, dialogs } = setup();
      const result = await callback(press(owner, 'l', 'n'));
      expect(dialogs.open).toHaveBeenCalledWith('555', dialog);
      expect(result.editText).toContain('30 min');
    });

    it('adds a typed block and sends the plan', async () => {
      const { typed, planner, dialogs, bot } = setup();
      await typed(owner, 'Prepare for the interview, 45', dialog);
      expect(planner.addBlock).toHaveBeenCalledWith('user-1', {
        title: 'Prepare for the interview',
        category: 'other',
        estimateMinutes: 45,
      });
      expect(dialogs.close).toHaveBeenCalledWith('555');
      expect(bot.sendToUser.mock.calls[0][1]).toContain('Added: Prepare for the interview');
    });

    it('keeps the dialog open on unreadable input', async () => {
      const { typed, planner, dialogs, bot } = setup();
      await typed(owner, 'Read docs, 2', dialog);
      expect(planner.addBlock).not.toHaveBeenCalled();
      expect(dialogs.close).not.toHaveBeenCalled();
      expect(bot.sendToUser.mock.calls[0][1]).toContain('Could not read that');
    });

    it('closes the dialog on any other button', async () => {
      const { callback, dialogs } = setup();
      await callback(press(owner, 'l', 'v'));
      expect(dialogs.close).toHaveBeenCalledWith('555');
    });
  });

  it('sends a fresh plan message from a nudge without editing the nudge', async () => {
    const { callback, bot } = setup();
    const result = await callback(press(owner, 'l', 'm'));
    expect(result).toEqual({});
    expect(bot.sendToUser).toHaveBeenCalledTimes(1);
  });
});
