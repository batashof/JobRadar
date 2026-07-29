import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorView } from './error-view';

function stubHealth(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(impl));
}

function setLanguageCookie(lang: string) {
  document.cookie = `jr_lang=${lang}; path=/`;
}

const unreachable = async () => {
  throw new TypeError('Failed to fetch');
};

describe('ErrorView', () => {
  afterEach(() => {
    document.cookie = 'jr_lang=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT';
    vi.unstubAllGlobals();
  });

  it('explains the outage when the API health probe fails', async () => {
    setLanguageCookie('en');
    stubHealth(unreachable);

    render(<ErrorView reset={() => undefined} />);

    expect(await screen.findByText(/JobRadar is waking up/i)).toBeTruthy();
    expect(screen.getByText(/free instance that sleeps/i)).toBeTruthy();
  });

  it('shows a generic message when the API is healthy (a real app bug)', async () => {
    setLanguageCookie('en');
    stubHealth(async () => ({ ok: true }));

    render(<ErrorView reset={() => undefined} />);

    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
  });

  it('treats a non-2xx health response as an outage too', async () => {
    setLanguageCookie('en');
    stubHealth(async () => ({ ok: false, status: 502 }));

    render(<ErrorView reset={() => undefined} />);

    expect(await screen.findByText(/JobRadar is waking up/i)).toBeTruthy();
  });

  it('renders in the language from the mirror cookie, with no provider above it', async () => {
    setLanguageCookie('ru');
    stubHealth(unreachable);

    render(<ErrorView reset={() => undefined} />);

    expect(await screen.findByText(/JobRadar просыпается/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('falls back to the default language when no cookie is set', async () => {
    stubHealth(unreachable);

    render(<ErrorView reset={() => undefined} />);

    expect(await screen.findByText(/JobRadar просыпается/i)).toBeTruthy();
  });

  it('calls reset when the retry button is pressed', async () => {
    setLanguageCookie('en');
    stubHealth(async () => ({ ok: true }));
    const reset = vi.fn();

    render(<ErrorView reset={reset} />);
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(reset).toHaveBeenCalledOnce();
  });
});
