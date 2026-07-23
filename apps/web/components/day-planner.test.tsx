import type {
  DayPlanDetail,
  PlanBlockItem,
  PlanCandidatesResponse,
  PlannerSettings,
  PlannerTodayResponse,
} from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DayPlanner } from './day-planner';

const mocks = vi.hoisted(() => ({
  addBlock: vi.fn(),
  acceptDayPlan: vi.fn(),
  createDayPlan: vi.fn(),
  dropBlock: vi.fn(),
  getCandidates: vi.fn(),
  reorderBlocks: vi.fn(),
  setPlanIntent: vi.fn(),
  updateBlock: vi.fn(),
  updatePlannerSettings: vi.fn(),
}));

vi.mock('@/lib/planner', () => mocks);

const settings: PlannerSettings = {
  timezone: 'UTC',
  morningRitualAt: '09:00',
  eveningReviewAt: '20:00',
  capacityMinutes: 120,
  defaultBlockMinutes: 30,
  categoryTargets: null,
  telegramChatId: null,
  telegramEnabled: false,
  escalationAfterMinutes: 20,
  escalationMaxRepeats: 2,
  estimationFactor: 1.8,
  estimationFactorByCategory: null,
};

function block(overrides: Partial<PlanBlockItem> = {}): PlanBlockItem {
  return {
    id: 'block-1',
    position: 0,
    title: 'Apply to Acme',
    details: null,
    category: 'job_search',
    sourceKind: 'manual',
    sourceRef: null,
    estimateMinutes: 30,
    correctedEstimateMinutes: 54,
    actualMinutes: 0,
    status: 'pending',
    skipReason: null,
    outcomeNote: null,
    carriedFromBlockId: null,
    carryCount: 0,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function plan(overrides: Partial<DayPlanDetail> = {}): DayPlanDetail {
  return {
    id: 'plan-1',
    planDate: '2026-07-23',
    status: 'draft',
    generatedBy: 'manual',
    intent: null,
    acceptedAt: null,
    closedAt: null,
    autoClosed: false,
    review: null,
    blocks: [block()],
    ...overrides,
  };
}

function today(overrides: Partial<PlannerTodayResponse> = {}): PlannerTodayResponse {
  return { today: '2026-07-23', plan: plan(), settings, ...overrides };
}

const noCandidates: PlanCandidatesResponse = { candidates: [], debt: { count: 0, minutes: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCandidates.mockResolvedValue(noCandidates);
});

describe('DayPlanner', () => {
  it('offers to start the day when nothing is planned yet', async () => {
    mocks.createDayPlan.mockResolvedValue(plan({ blocks: [] }));
    render(
      <DayPlanner initial={today({ plan: null })} initialCandidates={noCandidates} />,
    );

    expect(screen.getByText('Today is not planned yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start today’s plan' }));
    expect(mocks.createDayPlan).toHaveBeenCalled();
  });

  it('shows planned vs capacity and the personal estimation factor', () => {
    render(<DayPlanner initial={today()} initialCandidates={noCandidates} />);
    // The corrected estimate is what counts against capacity, not the raw one.
    expect(screen.getByText('54 / 120 min planned')).toBeTruthy();
    expect(screen.getByText('Estimation factor ×1.80')).toBeTruthy();
  });

  it('requires the morning ritual: a draft can be accepted, and only with blocks', async () => {
    mocks.acceptDayPlan.mockResolvedValue(plan({ status: 'accepted' }));
    const { rerender } = render(
      <DayPlanner initial={today()} initialCandidates={noCandidates} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Take on the day' }));
    expect(mocks.acceptDayPlan).toHaveBeenCalledWith('plan-1');

    rerender(
      <DayPlanner
        initial={today({ plan: plan({ blocks: [] }) })}
        initialCandidates={noCandidates}
      />,
    );
    expect(screen.getByRole('button', { name: 'Take on the day' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('adds a candidate to the queue carrying its source and debt backlink', async () => {
    const candidates: PlanCandidatesResponse = {
      candidates: [
        {
          key: 'debt:block-9',
          sourceKind: 'debt',
          category: 'learning',
          title: 'Anthropic course, module 3',
          reason: 'Unfinished since 2026-07-22 — carried 2×',
          sourceRef: null,
          estimateMinutes: 45,
          carryCount: 2,
          carriedFromBlockId: 'block-9',
        },
      ],
      debt: { count: 1, minutes: 45 },
    };
    mocks.addBlock.mockResolvedValue(plan());
    render(<DayPlanner initial={today()} initialCandidates={candidates} />);

    expect(screen.getByText('Debt: 1 · 45 min')).toBeTruthy();
    // The first "Add" is the candidate row; the last one belongs to the form.
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);

    expect(mocks.addBlock).toHaveBeenCalledWith({
      title: 'Anthropic course, module 3',
      details: 'Unfinished since 2026-07-22 — carried 2×',
      category: 'learning',
      sourceKind: 'debt',
      sourceRef: undefined,
      estimateMinutes: 45,
      carriedFromBlockId: 'block-9',
    });
  });

  it('reorders the queue as a full id list', async () => {
    const blocks = [block({ id: 'b1' }), block({ id: 'b2', position: 1 })];
    mocks.reorderBlocks.mockResolvedValue(plan({ blocks }));
    render(<DayPlanner initial={today({ plan: plan({ blocks }) })} initialCandidates={noCandidates} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]!);
    expect(mocks.reorderBlocks).toHaveBeenCalledWith('plan-1', ['b2', 'b1']);
  });

  it('drops a block only with an explicit reason', async () => {
    mocks.dropBlock.mockResolvedValue(plan({ blocks: [block({ status: 'dropped' })] }));
    render(<DayPlanner initial={today()} initialCandidates={noCandidates} />);

    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    fireEvent.change(screen.getByLabelText('Why are you dropping it?'), {
      target: { value: 'avoided' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Drop it' }));

    expect(mocks.dropBlock).toHaveBeenCalledWith('block-1', { reason: 'avoided' });
  });

  it('adds a hand-written block from the form', async () => {
    mocks.addBlock.mockResolvedValue(plan());
    render(<DayPlanner initial={today()} initialCandidates={noCandidates} />);

    fireEvent.change(screen.getByLabelText('Block'), { target: { value: 'Anthropic course' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' }).at(-1)!);

    await waitFor(() =>
      expect(mocks.addBlock).toHaveBeenCalledWith({
        title: 'Anthropic course',
        category: 'other',
        estimateMinutes: 30,
      }),
    );
  });

  it('surfaces an API failure instead of silently doing nothing', async () => {
    mocks.acceptDayPlan.mockRejectedValue(new Error('This day is already closed'));
    render(<DayPlanner initial={today()} initialCandidates={noCandidates} />);

    fireEvent.click(screen.getByRole('button', { name: 'Take on the day' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This day is already closed');
  });
});
