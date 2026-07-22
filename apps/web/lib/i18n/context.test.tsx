import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiFetch, refresh } = vi.hoisted(() => ({ apiFetch: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { I18nProvider, useI18n } from './context';

function Probe() {
  const { t } = useI18n();
  return <p>{t('detail.briefTitle')}</p>;
}

afterEach(() => {
  vi.clearAllMocks();
  document.cookie = 'jr_lang=; max-age=0; path=/';
});

describe('I18nProvider', () => {
  it('renders the initial language and switches on toggle', async () => {
    apiFetch.mockResolvedValue({ user: {} });
    render(
      <I18nProvider initialLanguage="en">
        <LanguageSwitcher />
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByText('Vacancy brief')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'RU' }));

    // Optimistic switch is immediate.
    expect(screen.getByText('Бриф по вакансии')).toBeTruthy();
    // Persists to the account and mirrors the cookie.
    expect(apiFetch).toHaveBeenCalledWith('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ language: 'ru' }),
    });
    expect(document.cookie).toContain('jr_lang=ru');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('does not call the API when persist is false (pre-auth pages)', () => {
    render(
      <I18nProvider initialLanguage="ru" persist={false}>
        <LanguageSwitcher />
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByText('Бриф по вакансии')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));

    expect(screen.getByText('Vacancy brief')).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(document.cookie).toContain('jr_lang=en');
  });
});
