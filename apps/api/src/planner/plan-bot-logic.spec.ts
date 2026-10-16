import type { DayPlanDetail, PlanBlockItem } from '@jobradar/shared';

import {
  blockActions,
  blockState,
  callbackData,
  composeNotice,
  fit,
  MESSAGE_LIMIT,
  parseBlockInput,
  parseCallback,
  type PlanView,
  renderAddPrompt,
  renderBlock,
  renderCloseConfirm,
  renderComposeFailed,
  renderPlan,
  renderReview,
} from './plan-bot-logic';

const ID_A = '11111111-2222-4333-8444-555555555555';
const ID_B = '66666666-7777-4888-9999-aaaaaaaaaaaa';

function block(over: Partial<PlanBlockItem> = {}): PlanBlockItem {
  return {
    id: ID_A,
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

const NOW = new Date('2026-10-16T10:00:00Z');

function view(p: DayPlanDetail | null, lang: 'en' | 'ru' = 'en'): PlanView {
  return { lang, now: NOW, today: '2026-10-16', plan: p, capacityMinutes: 240 };
}

const buttonTexts = (keyboard: { text: string }[][]) => keyboard.flat().map((b) => b.text);
const allData = (keyboard: { callbackData?: string }[][]) =>
  keyboard.flat().map((b) => b.callbackData);

describe('parseCallback', () => {
  it('reads plan-level actions', () => {
    expect(parseCallback(['l', 'v'])).toEqual({ kind: 'view' });
    expect(parseCallback(['l', 'm'])).toEqual({ kind: 'send' });
    expect(parseCallback(['l', 'g'])).toEqual({ kind: 'compose', regenerate: false });
    expect(parseCallback(['l', 'r'])).toEqual({ kind: 'compose', regenerate: true });
    expect(parseCallback(['l', 'a'])).toEqual({ kind: 'accept' });
    expect(parseCallback(['l', 'n'])).toEqual({ kind: 'add' });
    expect(parseCallback(['l', 'c'])).toEqual({ kind: 'askClose' });
    expect(parseCallback(['l', 'z'])).toEqual({ kind: 'close' });
  });

  it('reads block actions with a uuid', () => {
    expect(parseCallback(['l', 'o', ID_A])).toEqual({ kind: 'open', id: ID_A });
    expect(parseCallback(['l', 's', ID_A])).toEqual({ kind: 'start', id: ID_A });
    expect(parseCallback(['l', 'p', ID_A])).toEqual({ kind: 'pause', id: ID_A });
    expect(parseCallback(['l', 'd', ID_A])).toEqual({ kind: 'done', id: ID_A });
    expect(parseCallback(['l', 'x', ID_A])).toEqual({ kind: 'drop', id: ID_A });
  });

  it('rejects foreign namespaces, unknown actions and bad ids', () => {
    expect(parseCallback(['n', 'v'])).toBeNull();
    expect(parseCallback(['l'])).toBeNull();
    expect(parseCallback(['l', 'q'])).toBeNull();
    expect(parseCallback(['l', 's'])).toBeNull();
    expect(parseCallback(['l', 's', 'not-a-uuid'])).toBeNull();
  });

  it('round-trips the data it builds, within 64 bytes', () => {
    for (const action of ['open', 'start', 'pause', 'done', 'drop'] as const) {
      const data = callbackData.block(action, ID_A);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parseCallback(data.split(':'))).toEqual({ kind: action, id: ID_A });
    }
  });
});

describe('parseBlockInput', () => {
  it.each([
    ['Prepare for the interview, 45', 'Prepare for the interview', 45],
    ['Prepare for the interview 45', 'Prepare for the interview', 45],
    ['Подготовка — 60 мин', 'Подготовка', 60],
    ['Отклики 30м', 'Отклики', 30],
    ['Deep work: 90 min.', 'Deep work', 90],
  ])('reads %p', (text, title, minutes) => {
    expect(parseBlockInput(text)).toEqual({ title, minutes });
  });

  it('takes a bare title with default minutes', () => {
    expect(parseBlockInput('  Update the CV  ')).toEqual({ title: 'Update the CV', minutes: null });
  });

  it('rejects empty text, a bare number and minutes out of range', () => {
    expect(parseBlockInput('   ')).toBeNull();
    expect(parseBlockInput('45')).toBeNull();
    expect(parseBlockInput('Read docs, 2')).toBeNull();
    expect(parseBlockInput('Read docs, 600')).toBeNull();
    expect(parseBlockInput('x'.repeat(201))).toBeNull();
  });
});

describe('blockState and blockActions', () => {
  it('derives paused from a pending block with time on it', () => {
    expect(blockState(block())).toBe('planned');
    expect(blockState(block({ status: 'active' }))).toBe('running');
    expect(blockState(block({ actualMinutes: 10 }))).toBe('paused');
    expect(blockState(block({ startedAt: NOW.toISOString() }))).toBe('paused');
    expect(blockState(block({ status: 'done' }))).toBe('done');
  });

  it('offers only the actions valid for the state', () => {
    expect(blockActions('planned', false)).toEqual(['start', 'done', 'drop']);
    expect(blockActions('paused', false)).toEqual(['start', 'done', 'drop']);
    expect(blockActions('running', false)).toEqual(['pause', 'done']);
    expect(blockActions('done', false)).toEqual([]);
    expect(blockActions('skipped', false)).toEqual([]);
    expect(blockActions('planned', true)).toEqual([]);
  });
});

describe('renderPlan', () => {
  it('offers Compose and Add when there is no plan', () => {
    const screen = renderPlan(view(null, 'ru'));
    expect(screen.text).toContain('План на');
    expect(screen.text).toContain('ничего не запланировано');
    expect(buttonTexts(screen.keyboard)).toEqual(['✨ Составить план', '➕ Добавить блок']);
    expect(allData(screen.keyboard)).toEqual(['l:g', 'l:n']);
  });

  it('treats a plan of dropped blocks as empty', () => {
    const screen = renderPlan(view(plan({ blocks: [block({ status: 'dropped' })] })));
    expect(allData(screen.keyboard)).toEqual(['l:g', 'l:n']);
  });

  it('lists a draft in order with status icons, timing and draft buttons', () => {
    const p = plan({
      blocks: [
        block({ id: ID_B, position: 1, title: 'Second', status: 'done', actualMinutes: 25 }),
        block({ id: ID_A, position: 0, title: 'First <b>', status: 'active', actualMinutes: 5 }),
      ],
      activeSession: { blockId: ID_A, startedAt: '2026-10-16T09:50:00Z', bankedMinutes: 5 },
    });
    const screen = renderPlan(view(p));

    expect(screen.text).toContain('Draft');
    expect(screen.text).toContain('▶️ 1. <b>First &lt;b&gt;</b> — 15 / 30 min');
    expect(screen.text).toContain('✅ 2. <b>Second</b> — 25 min');
    expect(screen.text).toContain('Planned 60 of 240 min · ✅ 1 of 2 done');
    expect(screen.keyboard[0]).toEqual([{ text: '▶️ 1. First <b>', callbackData: `l:o:${ID_A}` }]);
    expect(buttonTexts(screen.keyboard.slice(2))).toEqual([
      '✅ Accept',
      '🔄 Regenerate',
      '➕ Add a block',
      '🌙 Close the day',
    ]);
    expect(screen.keyboard.every((row) => row.length <= 2)).toBe(true);
  });

  it('shows paused blocks and accepted-day buttons', () => {
    const screen = renderPlan(
      view(plan({ status: 'accepted', blocks: [block({ actualMinutes: 12 })] }), 'ru'),
    );
    expect(screen.text).toContain('День принят');
    expect(screen.text).toContain('⏸ 1.');
    expect(screen.text).toContain('12 / 30 мин');
    expect(buttonTexts(screen.keyboard.slice(1))).toEqual([
      '➕ Добавить блок',
      '🔄 Обновить',
      '🌙 Закрыть день',
    ]);
  });

  it('shows the day result and no buttons once closed', () => {
    const screen = renderPlan(
      view(
        plan({
          status: 'closed',
          review: {
            completedBlocks: 1,
            totalBlocks: 3,
            plannedMinutes: 90,
            actualMinutes: 70,
            minutesByCategory: { job_search: 70 },
            debtCreated: 2,
          },
        }),
      ),
    );
    expect(screen.text).toContain('Day closed');
    expect(screen.text).toContain('1 of 3 blocks done');
    expect(screen.text).toContain('Planned 90 min, actual 70 min');
    expect(screen.text).toContain('Going into debt: 2');
    expect(screen.keyboard).toEqual([]);
  });

  it('puts a notice above the plan and stays within the message cap', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      block({
        id: `${ID_A.slice(0, -2)}${String(i).padStart(2, '0')}`,
        position: i,
        title: 'x'.repeat(200),
      }),
    );
    const screen = renderPlan(view(plan({ blocks: many })), 'Added: x');
    expect(screen.text).toContain('Added: x');
    expect(screen.text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
  });
});

describe('renderBlock', () => {
  it('offers Start, Done, Delete and Back on a planned block', () => {
    const screen = renderBlock(view(plan()), block({ details: 'No answer for 7 days' }));
    expect(screen.text).toContain('Follow up: Acme');
    expect(screen.text).toContain('No answer for 7 days');
    expect(screen.text).toContain('Category: Job search');
    expect(buttonTexts(screen.keyboard)).toEqual(['▶️ Start', '✅ Done', '🗑 Delete', '⬅️ Back']);
    expect(allData(screen.keyboard)).toEqual([`l:s:${ID_A}`, `l:d:${ID_A}`, `l:x:${ID_A}`, 'l:v']);
  });

  it('offers Pause and Done on a running block, Resume on a paused one', () => {
    const running = block({ status: 'active' });
    expect(
      buttonTexts(renderBlock(view(plan({ blocks: [running] }), 'ru'), running).keyboard),
    ).toEqual(['⏸ Пауза', '✅ Готово', '⬅️ Назад']);
    const paused = block({ actualMinutes: 5 });
    expect(buttonTexts(renderBlock(view(plan({ blocks: [paused] })), paused).keyboard)[0]).toBe(
      '▶️ Resume',
    );
  });

  it('offers only Back on a finished block', () => {
    const done = block({ status: 'done', actualMinutes: 20 });
    const screen = renderBlock(view(plan({ blocks: [done] })), done);
    expect(screen.text).toContain('Spent: 20 min');
    expect(buttonTexts(screen.keyboard)).toEqual(['⬅️ Back']);
  });
});

describe('small screens', () => {
  it('confirms closing with a named button', () => {
    const screen = renderCloseConfirm('ru');
    expect(screen.text).toContain('Закрыть день?');
    expect(allData(screen.keyboard)).toEqual(['l:z', 'l:v']);
  });

  it('offers a retry when composing failed', () => {
    expect(allData(renderComposeFailed('en').keyboard)).toEqual(['l:g', 'l:n', 'l:v']);
  });

  it('prompts for a typed block with the default minutes', () => {
    const screen = renderAddPrompt('en', 25);
    expect(screen.text).toContain('25 min');
    expect(allData(screen.keyboard)).toEqual(['l:v']);
  });

  it('explains an empty or fallback draft', () => {
    expect(composeNotice('en', plan({ blocks: [] }))).toContain('Nothing to compose');
    expect(composeNotice('en', plan({ generatedBy: 'fallback' }))).toContain('AI was unavailable');
    expect(composeNotice('en', plan())).toBeUndefined();
  });

  it('renders a review note escaped', () => {
    const text = renderReview('en', {
      completedBlocks: 0,
      totalBlocks: 0,
      plannedMinutes: 0,
      actualMinutes: 0,
      minutesByCategory: {},
      debtCreated: 0,
      note: '<tired>',
    });
    expect(text).toContain('&lt;tired&gt;');
  });

  it('cuts text past the cap', () => {
    expect(fit('a'.repeat(5000))).toHaveLength(MESSAGE_LIMIT);
  });
});
