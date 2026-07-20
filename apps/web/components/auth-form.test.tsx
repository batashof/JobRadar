import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const { replace, refresh, loginMock, signupMock } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  loginMock: vi.fn(),
  signupMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/auth', () => ({ login: loginMock, signup: signupMock }));

import { AuthForm } from './auth-form';

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('AuthForm', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders login copy in login mode', () => {
    render(<AuthForm mode="login" />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('renders signup copy in signup mode', () => {
    render(<AuthForm mode="signup" />);
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeTruthy();
  });

  it('shows a client-side validation error and does not call the API', () => {
    render(<AuthForm mode="signup" />);
    fill('not-an-email', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(screen.getByRole('alert').textContent).toBeTruthy();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it('logs in with normalized input and redirects to /app', async () => {
    loginMock.mockResolvedValue({ user: { id: '1', email: 'a@b.com', digestEnabled: true } });
    render(<AuthForm mode="login" />);
    fill('A@B.com', 'supersecret');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith({ email: 'a@b.com', password: 'supersecret' }));
    expect(replace).toHaveBeenCalledWith('/app');
    expect(refresh).toHaveBeenCalled();
  });

  it('surfaces an API error message', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'Invalid email or password'));
    render(<AuthForm mode="login" />);
    fill('a@b.com', 'supersecret');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Invalid email or password'),
    );
    expect(replace).not.toHaveBeenCalled();
  });
});
