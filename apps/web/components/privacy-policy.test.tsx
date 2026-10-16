import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PrivacyPolicy } from './privacy-policy';

describe('PrivacyPolicy', () => {
  it('renders the key sections in English', () => {
    render(<PrivacyPolicy lang="en" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What JobRadar stores' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Who sees it' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How long it is kept' })).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Telegram user id');
    expect(text).toContain('PDF');
    expect(text).toContain('Groq');
    expect(text).toContain('/delete');
  });

  it('renders the key sections in Russian', () => {
    render(<PrivacyPolicy lang="ru" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Политика конфиденциальности' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Что хранит JobRadar' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Кто это видит' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Сколько хранится' })).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Groq');
    expect(text).toContain('/delete');
  });

  it('keeps the language switch on the privacy page and links to the bot', () => {
    render(<PrivacyPolicy lang="ru" />);
    expect(screen.getByRole('link', { name: 'English' }).getAttribute('href')).toBe(
      '/privacy?lang=en',
    );
    expect(
      screen.getByRole('link', { name: 'Открыть в Telegram' }).getAttribute('href'),
    ).toBe('https://t.me/JobRadarAppBot');
  });
});
