import { elapsedMinutes, type PlanBlockItem } from '@jobradar/shared';

/**
 * The decision half of `planner:tick` (ADR-015 §7): pure, so the rules that
 * decide when the planner pokes the user are pinned by tests instead of by a
 * clock. The IO half (loading users, writing nudges, closing days) lives in
 * `planner-tick.service.ts`.
 */

export type NudgeKind = 'morning' | 'block_start' | 'midway' | 'evening' | 'escalation' | 'debt';

/** A block is "running long" past this multiple of its corrected estimate. */
export const MIDWAY_OVERRUN_RATIO = 1.5;

export interface TickPlanState {
  /** Minutes since local midnight, in the user's timezone. */
  localMinutes: number;
  morningRitualAt: string;
  eveningReviewAt: string;
  plan: { id: string; status: 'draft' | 'accepted' | 'closed' } | null;
  blocks: Pick<PlanBlockItem, 'id' | 'status' | 'correctedEstimateMinutes' | 'actualMinutes'>[];
  activeSession: { blockId: string; startedAt: string; bankedMinutes: number } | null;
  debtCount: number;
  /** Keys of nudges already raised today: `kind` or `kind:blockId`. */
  raised: Set<string>;
}

export interface PlannedNudge {
  kind: NudgeKind;
  blockId?: string;
  /** Dedup key; also what the caller records to avoid raising it twice. */
  key: string;
}

/** `HH:MM` → minutes since midnight; unparsable values never fire. */
export function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since local midnight for an instant in an IANA timezone. */
export function localMinutesOfDay(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * Which nudges are due right now. Each is raised at most once per day (or per
 * block), so a minute-granularity tick does not turn into a stream of pokes.
 */
export function decideNudges(state: TickPlanState, now: Date): PlannedNudge[] {
  const due: PlannedNudge[] = [];
  const add = (kind: NudgeKind, blockId?: string) => {
    const key = blockId ? `${kind}:${blockId}` : kind;
    if (!state.raised.has(key)) due.push({ kind, key, ...(blockId ? { blockId } : {}) });
  };

  const morningDue = state.localMinutes >= timeToMinutes(state.morningRitualAt);
  const eveningDue = state.localMinutes >= timeToMinutes(state.eveningReviewAt);

  // Morning: there is no plan yet, or it was never taken on.
  if (morningDue && (!state.plan || state.plan.status === 'draft')) add('morning');
  if (morningDue && state.debtCount > 0) add('debt');

  if (state.plan?.status === 'accepted') {
    // Nothing is running and there is still work queued.
    if (!state.activeSession && state.blocks.some((block) => block.status === 'pending')) {
      add('block_start');
    }

    if (state.activeSession) {
      const block = state.blocks.find((b) => b.id === state.activeSession?.blockId);
      if (block) {
        const elapsed = elapsedMinutes(state.activeSession, now);
        if (elapsed > block.correctedEstimateMinutes * MIDWAY_OVERRUN_RATIO) {
          add('midway', block.id);
        }
      }
    }
  }

  // Evening: the day is still open when the review time has passed.
  if (eveningDue && state.plan && state.plan.status !== 'closed') add('evening');

  return due;
}

/** A sent nudge nobody acknowledged is escalated, then recorded as ignored. */
export function escalationAction(
  nudge: { sentAt: Date | null; repeatIndex: number },
  now: Date,
  settings: { escalationAfterMinutes: number; escalationMaxRepeats: number },
): 'wait' | 'repeat' | 'give_up' {
  if (!nudge.sentAt) return 'wait';
  const waited = (now.getTime() - nudge.sentAt.getTime()) / 60_000;
  if (waited < settings.escalationAfterMinutes) return 'wait';
  return nudge.repeatIndex < settings.escalationMaxRepeats ? 'repeat' : 'give_up';
}
