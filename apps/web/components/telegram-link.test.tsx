import type { TelegramLinkStatus } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getTelegramStatus, startTelegramLink, unlinkTelegram, updatePlannerSettings } = vi.hoisted(
  () => ({
    getTelegramStatus: vi.fn(),
    startTelegramLink: vi.fn(),
    unlinkTelegram: vi.fn(),
    updatePlannerSettings: vi.fn(),
  }),
);

vi.mock('@/lib/bot', () => ({ getTelegramStatus, startTelegramLink, unlinkTelegram }));
vi.mock('@/lib/planner', () => ({ updatePlannerSettings }));

import { TelegramLink } from './telegram-link';

function status(overrides: Partial<TelegramLinkStatus> = {}): TelegramLinkStatus {
  return {
    botConfigured: true,
    botUsername: 'JobRadarBot',
    linked: false,
    chatId: null,
    username: null,
    linkedAt: null,
    ...overrides,
  };
}

const linked = status({
  linked: true,
  chatId: '555',
  username: 'vlad',
  linkedAt: '2026-08-10T09:00:00.000Z',
});

describe('TelegramLink', () => {
  afterEach(() => vi.clearAllMocks());

  it('offers to connect when the account is not linked', () => {
    render(<TelegramLink initial={status()} plannerEnabled={false} />);
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
  });

  it('says the channel is off when the server has no bot token', () => {
    render(<TelegramLink initial={status({ botConfigured: false })} plannerEnabled={false} />);
    expect(screen.getByText(/not configured on the server/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
  });

  it('shows the deep link after starting a link, then confirms once the user pressed Start', async () => {
    startTelegramLink.mockResolvedValue({
      deepLink: 'https://t.me/JobRadarBot?start=tok-1',
      expiresAt: '2026-08-10T12:15:00.000Z',
    });
    getTelegramStatus.mockResolvedValue(linked);

    render(<TelegramLink initial={status()} plannerEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));

    const open = (await screen.findByRole('link', { name: 'Open Telegram' })) as HTMLAnchorElement;
    expect(open.href).toBe('https://t.me/JobRadarBot?start=tok-1');

    fireEvent.click(screen.getByRole('button', { name: 'I pressed Start' }));
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
    expect(screen.getByText('Linked to @vlad.')).toBeTruthy();
    // The stale deep link must disappear once it has been used.
    expect(screen.queryByRole('link', { name: 'Open Telegram' })).toBeNull();
  });

  it('keeps the deep link visible while the link is still pending', async () => {
    startTelegramLink.mockResolvedValue({
      deepLink: 'https://t.me/JobRadarBot?start=tok-1',
      expiresAt: '2026-08-10T12:15:00.000Z',
    });
    getTelegramStatus.mockResolvedValue(status());

    render(<TelegramLink initial={status()} plannerEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));
    fireEvent.click(await screen.findByRole('button', { name: 'I pressed Start' }));

    await waitFor(() => expect(getTelegramStatus).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Open Telegram' })).toBeTruthy();
  });

  it('surfaces a failure instead of leaving the button stuck', async () => {
    startTelegramLink.mockRejectedValue(new Error('boom'));

    render(<TelegramLink initial={status()} plannerEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));

    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeTruthy());
  });

  it('toggles planner nudges through the planner settings endpoint', async () => {
    updatePlannerSettings.mockResolvedValue({ telegramEnabled: true });

    render(<TelegramLink initial={linked} plannerEnabled={false} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(updatePlannerSettings).toHaveBeenCalledWith({ telegramEnabled: true }),
    );
    expect(checkbox.checked).toBe(true);
  });

  it('disconnects and returns to the connect state', async () => {
    unlinkTelegram.mockResolvedValue(status());

    render(<TelegramLink initial={linked} plannerEnabled={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy());
  });
});
