/**
 * Paces outbound bot messages to Telegram's broadcast limits: about 30
 * messages a second across all chats, and about one a second into any single
 * chat (roadmap 5.3). With one user the 429 retry in BotService was enough;
 * with many, a digest tick sending dozens of cards to each of them would sit
 * on 429s, and a chat that keeps hitting them is throttled for longer.
 *
 * Each call reserves the next free slot synchronously, before it waits, so
 * concurrent callers queue behind each other instead of all waking at once.
 */
export interface SendLimiterOptions {
  /** Messages per second across every chat. */
  globalPerSecond: number;
  /** Minimum gap between two messages into the same chat. */
  perChatIntervalMs: number;
}

export const TELEGRAM_SEND_LIMITS: SendLimiterOptions = {
  globalPerSecond: 30,
  perChatIntervalMs: 1000,
};

export interface LimiterClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: LimiterClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class SendLimiter {
  private readonly globalGapMs: number;
  private nextGlobalAt = 0;
  private readonly nextChatAt = new Map<string, number>();

  constructor(
    private readonly options: SendLimiterOptions = TELEGRAM_SEND_LIMITS,
    private readonly clock: LimiterClock = realClock,
  ) {
    this.globalGapMs = Math.ceil(1000 / options.globalPerSecond);
  }

  /** Resolves when a message to `chatId` may go out; returns how long it waited. */
  async acquire(chatId: string): Promise<number> {
    const now = this.clock.now();
    this.forgetIdleChats(now);

    const globalSlot = Math.max(now, this.nextGlobalAt);
    const slot = Math.max(globalSlot, this.nextChatAt.get(chatId) ?? 0);
    this.nextGlobalAt = globalSlot + this.globalGapMs;
    this.nextChatAt.set(chatId, slot + this.options.perChatIntervalMs);

    const wait = slot - now;
    if (wait > 0) await this.clock.sleep(wait);
    return wait;
  }

  /** Chats whose next slot is already past need no entry; keeps the map small. */
  private forgetIdleChats(now: number): void {
    for (const [chatId, at] of this.nextChatAt) {
      if (at <= now) this.nextChatAt.delete(chatId);
    }
  }
}
