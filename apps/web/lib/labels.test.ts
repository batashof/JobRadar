import { describe, expect, it } from 'vitest';

import { sourceLabel } from './labels';

describe('sourceLabel', () => {
  it('names the LinkedIn job-alert source (ADR-020)', () => {
    expect(sourceLabel('linkedin')).toBe('LinkedIn');
  });

  it('names the established boards', () => {
    expect(sourceLabel('telegram')).toBe('Telegram');
    expect(sourceLabel('ats')).toBe('Company boards');
  });

  it('falls back to the slug for an unknown source', () => {
    expect(sourceLabel('newboard')).toBe('newboard');
  });
});
