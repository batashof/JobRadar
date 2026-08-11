import type { DigestSettings as DigestSettingsValue } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { updateDigestSettings, runDigestNow } = vi.hoisted(() => ({
  updateDigestSettings: vi.fn(),
  runDigestNow: vi.fn(),
}));
vi.mock('@/lib/digest', () => ({ updateDigestSettings, runDigestNow }));

import { DigestSettings } from './digest-settings';

function settings(overrides: Partial<DigestSettingsValue> = {}): DigestSettingsValue {
  return {
    enabled: true,
    sendTimes: ['09:00'],
    maxItems: 10,
    minScore: 60,
    timezone: 'Europe/Belgrade',
    ...overrides,
  };
}

/** The component saves the whole object, so assertions target the fields that changed. */
const savedWith = (over: Partial<DigestSettingsValue>) => expect.objectContaining(over);

describe('DigestSettings', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the schedule, how many sends a day it is, and the timezone it means', () => {
    render(<DigestSettings initial={settings({ sendTimes: ['09:00', '19:00'] })} />);

    expect(screen.getByText(/Send times — 2 a day/)).toBeTruthy();
    expect(screen.getByText(/Europe\/Belgrade/)).toBeTruthy();
    expect((screen.getByLabelText('Send time 1') as HTMLInputElement).value).toBe('09:00');
    expect((screen.getByLabelText('Send time 2') as HTMLInputElement).value).toBe('19:00');
  });

  it('adds a second send and stores the schedule sorted', async () => {
    updateDigestSettings.mockResolvedValue(settings({ sendTimes: ['09:00', '19:00'] }));

    render(<DigestSettings initial={settings()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a time' }));

    await waitFor(() =>
      expect(updateDigestSettings).toHaveBeenCalledWith(
        savedWith({ sendTimes: ['09:00', '19:00'] }),
      ),
    );
  });

  it('stops offering more sends at the daily cap', () => {
    render(
      <DigestSettings initial={settings({ sendTimes: ['08:00', '12:00', '16:00', '20:00'] })} />,
    );
    expect(screen.queryByRole('button', { name: 'Add a time' })).toBeNull();
  });

  it('removes a send time but never the last one', async () => {
    updateDigestSettings.mockResolvedValue(settings());

    const { rerender } = render(<DigestSettings initial={settings({ sendTimes: ['09:00', '19:00'] })} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this time' })[0]!);
    await waitFor(() =>
      expect(updateDigestSettings).toHaveBeenCalledWith(savedWith({ sendTimes: ['19:00'] })),
    );

    rerender(<DigestSettings initial={settings()} />);
    expect(screen.queryByRole('button', { name: 'Remove this time' })).toBeNull();
  });

  it('drops a duplicated time instead of sending it to be rejected', async () => {
    updateDigestSettings.mockResolvedValue(settings());

    render(<DigestSettings initial={settings({ sendTimes: ['09:00', '19:00'] })} />);
    const second = screen.getByLabelText('Send time 2');
    fireEvent.change(second, { target: { value: '09:00' } });
    fireEvent.blur(second);

    await waitFor(() =>
      expect(updateDigestSettings).toHaveBeenCalledWith(savedWith({ sendTimes: ['09:00'] })),
    );
  });

  it('saves the per-send cap on blur', async () => {
    updateDigestSettings.mockResolvedValue(settings({ maxItems: 5 }));

    render(<DigestSettings initial={settings()} />);
    const input = screen.getByLabelText('Vacancies per send');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(updateDigestSettings).toHaveBeenCalledWith(savedWith({ maxItems: 5 })),
    );
  });

  it('turns the digest off', async () => {
    updateDigestSettings.mockResolvedValue(settings({ enabled: false }));

    render(<DigestSettings initial={settings()} />);
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(updateDigestSettings).toHaveBeenCalledWith(savedWith({ enabled: false })),
    );
  });

  it('sends on demand and reports how many vacancies went out', async () => {
    runDigestNow.mockResolvedValue({ sent: 4 });

    render(<DigestSettings initial={settings()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send it now' }));

    await waitFor(() => expect(screen.getByText(/Sent 4 vacancies/)).toBeTruthy());
  });

  it('explains an empty on-demand send rather than looking broken', async () => {
    runDigestNow.mockResolvedValue({ sent: 0 });

    render(<DigestSettings initial={settings()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send it now' }));

    await waitFor(() => expect(screen.getByText(/Nothing to send right now/)).toBeTruthy());
  });

  it('rolls back and explains itself when the save fails', async () => {
    updateDigestSettings.mockRejectedValue(new Error('boom'));

    render(<DigestSettings initial={settings()} />);
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(screen.getByText(/Could not save/i)).toBeTruthy());
    // The UI must not claim a schedule the server never accepted.
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});
