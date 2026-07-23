import { correctEstimate, type PlanCandidate } from '@jobradar/shared';

import type { ComposedBlock } from './prompts';

/**
 * The deterministic half of plan composition (ADR-015 §2): the ordering used
 * when no LLM key is configured or the gateway fails, and the capacity guard
 * applied to the LLM's answer as well — a plan that does not fit the day is
 * the exact failure mode this feature exists to prevent.
 */

/** A day is a commitment, not a backlog: even a huge capacity stays readable. */
export const MAX_COMPOSED_BLOCKS = 6;

/** Priority when composing without an LLM. Debt first, always. */
const FALLBACK_ORDER: Record<PlanCandidate['sourceKind'], number> = {
  debt: 0,
  application_followup: 1,
  interview_topic: 2,
  course: 3,
  vacancy_apply: 4,
  manual: 5,
};

/**
 * Keeps blocks while they fit the capacity measured in *corrected* minutes.
 * The first block is always kept — a day with one honest block beats none.
 */
export function fitToCapacity(
  blocks: ComposedBlock[],
  candidates: PlanCandidate[],
  capacityMinutes: number,
  estimationFactor: number,
): ComposedBlock[] {
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const kept: ComposedBlock[] = [];
  let total = 0;

  for (const block of blocks) {
    if (kept.length >= MAX_COMPOSED_BLOCKS) break;
    const candidate = byKey.get(block.key);
    if (!candidate) continue;
    const minutes = correctEstimate(
      block.estimateMinutes ?? candidate.estimateMinutes,
      estimationFactor,
    );
    if (kept.length > 0 && total + minutes > capacityMinutes) continue;
    kept.push(block);
    total += minutes;
  }

  return kept;
}

/** Ordering used when the LLM is unavailable; same capacity rules apply. */
export function fallbackCompose(
  candidates: PlanCandidate[],
  capacityMinutes: number,
  estimationFactor: number,
): ComposedBlock[] {
  const ordered = [...candidates].sort((a, b) => {
    const byKind = FALLBACK_ORDER[a.sourceKind] - FALLBACK_ORDER[b.sourceKind];
    if (byKind !== 0) return byKind;
    // Within debt, the most-carried block is the one rotting hardest.
    return (b.carryCount ?? 0) - (a.carryCount ?? 0);
  });

  return fitToCapacity(
    ordered.map((candidate) => ({ key: candidate.key })),
    candidates,
    capacityMinutes,
    estimationFactor,
  );
}
