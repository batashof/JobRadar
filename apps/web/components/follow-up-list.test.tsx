import type { ApplicationItem } from '@jobradar/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FollowUpList } from './follow-up-list';

const NOW = new Date('2026-07-20T12:00:00Z');

function item(id: string, daysAgo: number, remindAfterDays: number | null = null): ApplicationItem {
  return {
    id,
    stage: 'applied',
    stageOrder: 0,
    notes: '',
    appliedAt: null,
    lastActivityAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    remindAfterDays,
    createdAt: '2026-07-01T00:00:00.000Z',
    vacancy: {
      id: `vac-${id}`,
      title: `Job ${id}`,
      company: 'Acme',
      url: 'https://example.com/job',
      source: 'telegram',
    },
  };
}

describe('FollowUpList', () => {
  it('shows an all-clear message when nothing is due', () => {
    render(<FollowUpList items={[]} now={NOW} />);
    expect(screen.getByText(/Nothing needs a follow-up right now/)).toBeTruthy();
  });

  it('lists due applications with days waited and their threshold', () => {
    render(<FollowUpList items={[item('a1', 10), item('a2', 20, 14)]} now={NOW} />);
    expect(screen.getByText('Job a1')).toBeTruthy();
    expect(screen.getByText('10 days · limit 7')).toBeTruthy();
    expect(screen.getByText('20 days · limit 14')).toBeTruthy();
  });
});
