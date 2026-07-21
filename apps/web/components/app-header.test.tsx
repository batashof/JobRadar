import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { email: 'user@example.com' }, logout: logoutMock }),
}));

import { AppHeader } from './app-header';

describe('AppHeader', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders every nav link', () => {
    render(<AppHeader />);
    for (const label of ['Dashboard', 'Feed', 'Board', 'Profiles', 'Resume']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('starts with the mobile menu collapsed', () => {
    render(<AppHeader />);
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles the mobile menu open and closed via the burger button', () => {
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const toggle = screen.getByRole('button', { name: 'Close menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // Nav links are duplicated (desktop + mobile panel) once the menu is open.
    expect(screen.getAllByRole('link', { name: 'Feed' })).toHaveLength(2);

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Open menu' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('closes the mobile menu when a nav link is tapped', () => {
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const mobileLinks = screen.getAllByRole('link', { name: 'Board' });
    fireEvent.click(mobileLinks[mobileLinks.length - 1]!);
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
  });

  it('logs out from the mobile menu', () => {
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const logoutButtons = screen.getAllByRole('button', { name: 'Log out' });
    fireEvent.click(logoutButtons[logoutButtons.length - 1]!);
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });
});
