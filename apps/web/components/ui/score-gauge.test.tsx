import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScoreGauge, scoreColor } from './score-gauge';

describe('ScoreGauge', () => {
  it('renders the rounded percentage and an accessible label', () => {
    render(<ScoreGauge value={0.726} />);
    expect(screen.getByText('73%')).toBeTruthy();
    expect(screen.getByRole('img', { name: /73 percent/ })).toBeTruthy();
  });

  it('clamps out-of-range values', () => {
    render(<ScoreGauge value={1.5} />);
    expect(screen.getByText('100%')).toBeTruthy();
  });
});

describe('scoreColor', () => {
  it('bands red / amber / green by threshold', () => {
    expect(scoreColor(0.2)).toBe('#dc2626');
    expect(scoreColor(0.5)).toBe('#d97706');
    expect(scoreColor(0.85)).toBe('#16a34a');
  });
});
