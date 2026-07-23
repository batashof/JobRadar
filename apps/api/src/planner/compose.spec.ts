import type { PlanCandidate } from '@jobradar/shared';

import { fallbackCompose, fitToCapacity, MAX_COMPOSED_BLOCKS } from './compose';
import { buildComposePrompt, parseComposeReply } from './prompts';

function candidate(overrides: Partial<PlanCandidate> & { key: string }): PlanCandidate {
  return {
    sourceKind: 'manual',
    category: 'other',
    title: `Task ${overrides.key}`,
    reason: 'because',
    sourceRef: null,
    estimateMinutes: 30,
    ...overrides,
  };
}

const CANDIDATES: PlanCandidate[] = [
  candidate({ key: 'vacancy_apply:v1', sourceKind: 'vacancy_apply', estimateMinutes: 30 }),
  candidate({ key: 'debt:b1', sourceKind: 'debt', estimateMinutes: 45, carryCount: 1 }),
  candidate({ key: 'interview_topic:t1', sourceKind: 'interview_topic', estimateMinutes: 45 }),
  candidate({ key: 'application_followup:a1', sourceKind: 'application_followup', estimateMinutes: 15 }),
  candidate({ key: 'debt:b2', sourceKind: 'debt', estimateMinutes: 30, carryCount: 3 }),
];

describe('parseComposeReply', () => {
  it('keeps only keys that were actually offered', () => {
    const reply = JSON.stringify({
      blocks: [
        { key: 'debt:b1', title: 'Finish module 3', estimateMinutes: 40 },
        { key: 'invented:nope', title: 'Do something clever' },
        { key: 'application_followup:a1' },
      ],
    });

    expect(parseComposeReply(reply, CANDIDATES)).toEqual([
      { key: 'debt:b1', title: 'Finish module 3', estimateMinutes: 40 },
      { key: 'application_followup:a1' },
    ]);
  });

  it('drops repeats and out-of-range estimates', () => {
    const reply = JSON.stringify({
      blocks: [
        { key: 'debt:b1', estimateMinutes: 999 },
        { key: 'debt:b1', estimateMinutes: 30 },
        { key: 'debt:b2', estimateMinutes: 1 },
      ],
    });

    // The bad estimates fall back to the candidate's own timebox (no override).
    expect(parseComposeReply(reply, CANDIDATES)).toEqual([{ key: 'debt:b1' }, { key: 'debt:b2' }]);
  });

  it('survives fenced or chatty replies, and gives up cleanly on junk', () => {
    const fenced = '```json\n{"blocks":[{"key":"debt:b2"}]}\n```';
    expect(parseComposeReply(fenced, CANDIDATES)).toEqual([{ key: 'debt:b2' }]);
    expect(parseComposeReply('I cannot help with that', CANDIDATES)).toEqual([]);
    expect(parseComposeReply('{"blocks": not json}', CANDIDATES)).toEqual([]);
  });
});

describe('fitToCapacity', () => {
  it('measures against corrected minutes, not raw estimates', () => {
    const blocks = [{ key: 'debt:b1' }, { key: 'interview_topic:t1' }];
    // 45 x 1.8 = 81 already eats most of a 100-minute day.
    expect(fitToCapacity(blocks, CANDIDATES, 100, 1.8)).toEqual([{ key: 'debt:b1' }]);
    expect(fitToCapacity(blocks, CANDIDATES, 100, 1)).toEqual(blocks);
  });

  it('always keeps the first block, even when it alone overflows', () => {
    expect(fitToCapacity([{ key: 'debt:b1' }], CANDIDATES, 10, 1)).toEqual([{ key: 'debt:b1' }]);
  });

  it('honours a per-block estimate override', () => {
    const blocks = [{ key: 'debt:b1', estimateMinutes: 20 }, { key: 'interview_topic:t1' }];
    expect(fitToCapacity(blocks, CANDIDATES, 65, 1)).toEqual(blocks);
  });

  it('caps the day at a readable number of blocks', () => {
    const many = Array.from({ length: 10 }, (_, i) => candidate({ key: `manual:${i}`, estimateMinutes: 5 }));
    expect(fitToCapacity(many.map((c) => ({ key: c.key })), many, 600, 1)).toHaveLength(
      MAX_COMPOSED_BLOCKS,
    );
  });
});

describe('fallbackCompose (no LLM)', () => {
  it('puts debt first, rotting debt ahead of the rest, then follow-ups', () => {
    const composed = fallbackCompose(CANDIDATES, 240, 1);
    expect(composed.map((block) => block.key)).toEqual([
      'debt:b2',
      'debt:b1',
      'application_followup:a1',
      'interview_topic:t1',
      'vacancy_apply:v1',
    ]);
  });

  it('stops at the capacity', () => {
    // 30 + 45 = 75 fits in 80; the 15-minute follow-up would push it to 90.
    const composed = fallbackCompose(CANDIDATES, 80, 1);
    expect(composed.map((block) => block.key)).toEqual(['debt:b2', 'debt:b1']);
  });

  it('still slots in a small block that fits after a big one was skipped', () => {
    const composed = fallbackCompose(CANDIDATES, 90, 1);
    expect(composed.map((block) => block.key)).toEqual([
      'debt:b2',
      'debt:b1',
      'application_followup:a1',
    ]);
  });
});

describe('buildComposePrompt', () => {
  it('offers every candidate key and pins the output language', () => {
    const { system, user } = buildComposePrompt(CANDIDATES, {
      capacityMinutes: 240,
      estimationFactor: 1.8,
      intent: 'two applications',
      lang: 'ru',
    });

    expect(system).toContain('Use ONLY the given candidate keys');
    expect(system).toContain('Write every title in Russian');
    for (const c of CANDIDATES) expect(user).toContain(`key=${c.key}`);
    expect(user).toContain('Capacity today: 240 minutes.');
    expect(user).toContain('Estimation factor: 1.8');
    expect(user).toContain('two applications');
    expect(user).toContain('[carried 3x]');
  });
});
