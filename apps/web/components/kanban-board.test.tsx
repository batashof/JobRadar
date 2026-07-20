import type { ApplicationItem, ApplicationStage } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { deleteApplication, updateApplication } = vi.hoisted(() => ({
  deleteApplication: vi.fn(),
  updateApplication: vi.fn(),
}));

vi.mock('@/lib/applications', () => ({
  deleteApplication,
  updateApplication,
  reorderApplications: vi.fn(),
  listApplications: vi.fn(),
}));

import { KanbanBoard } from './kanban-board';

function app(id: string, stage: ApplicationStage, order: number, title: string): ApplicationItem {
  return {
    id,
    stage,
    stageOrder: order,
    notes: '',
    appliedAt: null,
    lastActivityAt: '2026-07-20T00:00:00.000Z',
    remindAfterDays: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    vacancy: { id: `vac-${id}`, title, company: 'Acme', url: 'https://x/y', source: 'remoteok' },
  };
}

describe('KanbanBoard', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders an empty state with no applications', () => {
    render(<KanbanBoard initial={[]} />);
    expect(screen.getByText(/No applications yet/i)).toBeTruthy();
  });

  it('groups cards under their stage columns', () => {
    render(
      <KanbanBoard
        initial={[app('a1', 'saved', 0, 'Saved Job'), app('a2', 'offer', 0, 'Offer Job')]}
      />,
    );
    expect(screen.getByText('Saved Job')).toBeTruthy();
    expect(screen.getByText('Offer Job')).toBeTruthy();
    // All seven stage columns render.
    expect(screen.getByText('Tech interview')).toBeTruthy();
    expect(screen.getByText('Withdrawn')).toBeTruthy();
  });

  it('removes a card optimistically on delete', async () => {
    deleteApplication.mockResolvedValue(undefined);
    render(<KanbanBoard initial={[app('a1', 'saved', 0, 'Saved Job')]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteApplication).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(screen.queryByText('Saved Job')).toBeNull());
  });

  it('saves notes on blur', async () => {
    updateApplication.mockResolvedValue({});
    render(<KanbanBoard initial={[app('a1', 'saved', 0, 'Saved Job')]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add notes' }));
    const textarea = screen.getByPlaceholderText('Notes…');
    fireEvent.change(textarea, { target: { value: 'Call recruiter' } });
    fireEvent.blur(textarea);

    await waitFor(() =>
      expect(updateApplication).toHaveBeenCalledWith('a1', { notes: 'Call recruiter' }),
    );
  });
});
