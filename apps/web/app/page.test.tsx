import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '@jobradar/shared';

import HomePage from './page';

describe('HomePage', () => {
  it('renders the app name as the main heading', () => {
    render(<HomePage />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(APP_NAME);
  });

  it('renders the phase 0 hello-world message', () => {
    render(<HomePage />);

    expect(screen.getByText(/phase 0 scaffold/i)).toBeTruthy();
  });
});
