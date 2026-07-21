import type { ApplicationStats } from '@jobradar/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FunnelStats } from './funnel-stats';

function stats(overrides: Partial<ApplicationStats> = {}): ApplicationStats {
  return {
    total: 10,
    byStage: { saved: 3, applied: 4, screening: 2, offer: 1 },
    funnel: [
      { stage: 'applied', reached: 7, conversion: null },
      { stage: 'screening', reached: 3, conversion: 3 / 7 },
      { stage: 'tech_interview', reached: 1, conversion: 1 / 3 },
      { stage: 'offer', reached: 1, conversion: 1 },
    ],
    ...overrides,
  };
}

describe('FunnelStats', () => {
  it('renders reached counts and conversion percentages per step', () => {
    render(<FunnelStats stats={stats()} />);

    const applied = within(screen.getByTestId('funnel-applied'));
    expect(applied.getByText('7')).toBeTruthy();
    expect(applied.getByText('sent')).toBeTruthy();

    const screening = within(screen.getByTestId('funnel-screening'));
    expect(screening.getByText('3')).toBeTruthy();
    expect(screening.getByText('43% of previous')).toBeTruthy();

    const offer = within(screen.getByTestId('funnel-offer'));
    expect(offer.getByText('100% of previous')).toBeTruthy();
  });

  it('shows an empty state until something is sent', () => {
    render(
      <FunnelStats
        stats={stats({
          total: 2,
          byStage: { saved: 2 },
          funnel: [
            { stage: 'applied', reached: 0, conversion: null },
            { stage: 'screening', reached: 0, conversion: null },
            { stage: 'tech_interview', reached: 0, conversion: null },
            { stage: 'offer', reached: 0, conversion: null },
          ],
        })}
      />,
    );
    expect(screen.getByText(/No sent applications yet/)).toBeTruthy();
  });
});
