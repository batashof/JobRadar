import { localDayKey } from '@jobradar/shared';

/**
 * Which send slot is due right now — pure, so the schedule rules are testable
 * without a clock, a database or a bot. Same split as `planner/tick-logic.ts`.
 */

/**
 * How late a slot may still fire. The API sleeps on the Render free tier, so a
 * missed slot is normal; sending 09:00's digest at 23:00 is not. Beyond this
 * the slot is consumed without being sent, and the next one takes over.
 */
export const SLOT_GRACE_MINUTES = 180;

export interface DueInput {
  /** `HH:MM` local times, any order. */
  sendTimes: string[];
  timezone: string;
  now: Date;
  /** `YYYY-MM-DD HH:MM` of the last consumed slot; null = never sent. */
  lastSentKey: string | null;
}

export type DueResult =
  /** Nothing to do: no slot has come round yet, or the current one is spent. */
  | { kind: 'idle' }
  /** Slot is due and fresh enough to send. */
  | { kind: 'send'; key: string; slot: string }
  /** Slot came and went while the process was down — consume it, don't send. */
  | { kind: 'stale'; key: string; slot: string };

/** Minutes since local midnight, in the given timezone. */
export function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

export function resolveDue(input: DueInput): DueResult {
  const nowMinutes = localMinutes(input.now, input.timezone);
  const day = localDayKey(input.now, safeZone(input.timezone));

  // The latest slot that has already come round today. Earlier ones are skipped
  // on purpose: if two slots elapsed while the process was down, only the most
  // recent is worth sending — the older one's vacancies are in the newer one.
  let due: { slot: string; minutes: number } | null = null;
  for (const slot of input.sendTimes) {
    const minutes = toMinutes(slot);
    if (minutes === null || minutes > nowMinutes) continue;
    if (!due || minutes > due.minutes) due = { slot, minutes };
  }
  if (!due) return { kind: 'idle' };

  const key = `${day} ${due.slot}`;
  if (key === input.lastSentKey) return { kind: 'idle' };

  const lateBy = nowMinutes - due.minutes;
  return lateBy > SLOT_GRACE_MINUTES
    ? { kind: 'stale', key, slot: due.slot }
    : { kind: 'send', key, slot: due.slot };
}

function toMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** An unknown IANA name would throw inside Intl; fall back rather than crash. */
function safeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}
