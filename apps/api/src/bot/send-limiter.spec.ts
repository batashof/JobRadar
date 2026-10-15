import { type LimiterClock, SendLimiter } from './send-limiter';

/** A clock that advances only when someone sleeps on it. */
function fakeClock(): LimiterClock & { slept: number[] } {
  let now = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  };
}

describe('SendLimiter', () => {
  it('lets the first message into a chat through at once', async () => {
    const clock = fakeClock();
    const limiter = new SendLimiter({ globalPerSecond: 30, perChatIntervalMs: 1000 }, clock);
    await expect(limiter.acquire('a')).resolves.toBe(0);
  });

  it('spaces messages into one chat by the per-chat interval', async () => {
    const clock = fakeClock();
    const limiter = new SendLimiter({ globalPerSecond: 30, perChatIntervalMs: 1000 }, clock);
    await limiter.acquire('a');
    await expect(limiter.acquire('a')).resolves.toBe(1000);
    await expect(limiter.acquire('a')).resolves.toBe(1000);
  });

  it('spaces messages across chats by the global rate only', async () => {
    const clock = fakeClock();
    const limiter = new SendLimiter({ globalPerSecond: 10, perChatIntervalMs: 1000 }, clock);
    await limiter.acquire('a');
    await expect(limiter.acquire('b')).resolves.toBe(100);
    await expect(limiter.acquire('c')).resolves.toBe(100);
  });

  it('queues concurrent callers instead of waking them together', async () => {
    let now = 0;
    const waits: number[] = [];
    const clock: LimiterClock = {
      now: () => now,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    };
    const limiter = new SendLimiter({ globalPerSecond: 30, perChatIntervalMs: 1000 }, clock);
    await Promise.all([limiter.acquire('a'), limiter.acquire('a'), limiter.acquire('a')]);
    expect(waits).toEqual([1000, 2000]);
    now = 10_000;
    // Long idle: the slot is free again.
    await expect(limiter.acquire('a')).resolves.toBe(0);
  });
});
