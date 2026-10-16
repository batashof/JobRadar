import type { ConfigService } from '@nestjs/config';

import { ApplicationRemindersScheduler } from './application-reminders.scheduler';
import type {
  ApplicationRemindersService,
  ReminderSweepResult,
} from './application-reminders.service';

const empty: ReminderSweepResult = { candidates: 0, sent: 0, failed: 0 };

function schedulerWith(run: jest.Mock, config: Record<string, string> = {}) {
  const configService = { get: (key: string) => config[key] } as unknown as ConfigService;
  return new ApplicationRemindersScheduler(
    { run } as unknown as ApplicationRemindersService,
    configService,
  );
}

const fire = (scheduler: ApplicationRemindersScheduler) =>
  (scheduler as unknown as { fire(): Promise<void> }).fire();

describe('ApplicationRemindersScheduler', () => {
  afterEach(() => jest.useRealTimers());

  it('sweeps hourly once started, and stops cleanly', async () => {
    jest.useFakeTimers();
    const run = jest.fn().mockResolvedValue(empty);
    const scheduler = schedulerWith(run);
    scheduler.onModuleInit();

    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.onModuleDestroy();
    scheduler.onModuleDestroy(); // idempotent
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not arm the timer when APPLICATION_REMINDERS_DISABLED is set', async () => {
    jest.useFakeTimers();
    const run = jest.fn().mockResolvedValue(empty);
    const scheduler = schedulerWith(run, { APPLICATION_REMINDERS_DISABLED: 'true' });
    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(run).not.toHaveBeenCalled();
  });

  it('never runs two sweeps at once', async () => {
    let resolve!: () => void;
    const run = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise<ReminderSweepResult>((r) => (resolve = () => r(empty))),
      )
      .mockResolvedValue(empty);
    const scheduler = schedulerWith(run);

    const first = fire(scheduler);
    const second = fire(scheduler);
    expect(run).toHaveBeenCalledTimes(1);
    resolve();
    await Promise.all([first, second]);

    await fire(scheduler);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('survives a failed sweep', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(empty);
    const scheduler = schedulerWith(run);
    await expect(fire(scheduler)).resolves.toBeUndefined();
    await fire(scheduler);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
