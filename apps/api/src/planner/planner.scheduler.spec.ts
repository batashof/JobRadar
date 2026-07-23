import type { ConfigService } from '@nestjs/config';

import type { PlannerTickService, TickResult } from './planner-tick.service';
import { PlannerScheduler } from './planner.scheduler';

const empty: TickResult = { users: 0, autoClosed: 0, raised: 0, escalated: 0, ignored: 0 };

function schedulerWith(run: jest.Mock, config: Record<string, string> = {}) {
  const configService = { get: (key: string) => config[key] } as unknown as ConfigService;
  return new PlannerScheduler({ run } as unknown as PlannerTickService, configService);
}

describe('PlannerScheduler', () => {
  it('starts and stops cleanly over the lifecycle', () => {
    const scheduler = schedulerWith(jest.fn().mockResolvedValue(empty));
    expect(() => {
      scheduler.onModuleInit();
      scheduler.onModuleDestroy();
      scheduler.onModuleDestroy(); // idempotent
    }).not.toThrow();
  });

  it('does not arm the timer when PLANNER_TICK_DISABLED is set', () => {
    const run = jest.fn().mockResolvedValue(empty);
    const scheduler = schedulerWith(run, { PLANNER_TICK_DISABLED: '1' });
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();
    // The kill switch means fire() is never wired up.
    expect(run).not.toHaveBeenCalled();
  });

  it('never runs two ticks at once', async () => {
    let resolve!: () => void;
    const run = jest
      .fn()
      .mockImplementationOnce(() => new Promise<TickResult>((r) => (resolve = () => r(empty))))
      .mockResolvedValue(empty);
    const scheduler = schedulerWith(run);

    // Two fires while the first is still in flight → only one call.
    const first = (scheduler as unknown as { fire(): Promise<void> }).fire();
    const second = (scheduler as unknown as { fire(): Promise<void> }).fire();
    expect(run).toHaveBeenCalledTimes(1);

    resolve();
    await Promise.all([first, second]);

    // Once the first finished, a later fire runs again.
    await (scheduler as unknown as { fire(): Promise<void> }).fire();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('swallows a tick failure so the interval survives', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(empty);
    const scheduler = schedulerWith(run);

    await expect(
      (scheduler as unknown as { fire(): Promise<void> }).fire(),
    ).resolves.toBeUndefined();
    await (scheduler as unknown as { fire(): Promise<void> }).fire();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
