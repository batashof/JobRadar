import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo, LogoMark } from './logo';

describe('LogoMark', () => {
  it('renders an accessible radar mark at the requested size', () => {
    render(<LogoMark size={40} />);
    const svg = screen.getByRole('img', { name: /logo/i });
    expect(svg.getAttribute('width')).toBe('40');
    expect(svg.getAttribute('height')).toBe('40');
  });

  it('scopes gradient ids per instance to avoid collisions', () => {
    const { container } = render(
      <>
        <LogoMark />
        <LogoMark />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((el) => el.id);
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('Logo', () => {
  it('shows the wordmark by default', () => {
    render(<Logo />);
    expect(screen.getByText('JobRadar')).toBeTruthy();
  });

  it('hides the wordmark when markOnly is set', () => {
    render(<Logo markOnly />);
    expect(screen.queryByText('JobRadar')).toBeNull();
  });
});
