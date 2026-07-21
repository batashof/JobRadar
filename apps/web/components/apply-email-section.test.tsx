import type { VacancyDetail } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchGmailStatus, startGmailOauth, draftApplyEmail, sendApplyEmail } = vi.hoisted(() => ({
  fetchGmailStatus: vi.fn(),
  startGmailOauth: vi.fn(),
  draftApplyEmail: vi.fn(),
  sendApplyEmail: vi.fn(),
}));

vi.mock('@/lib/outreach', () => ({
  fetchGmailStatus,
  startGmailOauth,
  draftApplyEmail,
  sendApplyEmail,
}));

import { ApplyEmailSection } from './apply-email-section';

const detail = {
  id: 'v1',
  title: 'Senior React Developer',
  applyContact: { kind: 'email', value: 'hr@acme.dev' },
} as unknown as VacancyDetail;

describe('ApplyEmailSection', () => {
  afterEach(() => vi.clearAllMocks());

  it('explains when Gmail is not configured server-side', async () => {
    fetchGmailStatus.mockResolvedValue({ configured: false, connected: false });
    render(<ApplyEmailSection detail={detail} coverLetter="Letter" />);

    await waitFor(() =>
      expect(screen.getByText(/not configured on the server/i)).toBeTruthy(),
    );
  });

  it('offers to connect Gmail when configured but not connected', async () => {
    fetchGmailStatus.mockResolvedValue({ configured: true, connected: false });
    render(<ApplyEmailSection detail={detail} coverLetter="Letter" />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeTruthy(),
    );
  });

  it('asks for a cover letter before drafting', async () => {
    fetchGmailStatus.mockResolvedValue({ configured: true, connected: true });
    render(<ApplyEmailSection detail={detail} coverLetter={null} />);

    await waitFor(() => expect(screen.getByText(/Generate a cover letter above/i)).toBeTruthy());
  });

  it('drafts, lets the user edit, and sends only on explicit confirmation', async () => {
    fetchGmailStatus.mockResolvedValue({ configured: true, connected: true });
    draftApplyEmail.mockResolvedValue({
      recipient: 'hr@acme.dev',
      subject: 'Senior React Developer — application',
      body: 'Hello,\n\nLetter\n\nResume attached.',
    });
    sendApplyEmail.mockResolvedValue({
      outreachId: 'o1',
      gmailMessageId: 'g1',
      sentAt: '2026-07-21T10:00:00.000Z',
    });

    render(<ApplyEmailSection detail={detail} coverLetter="Letter" />);

    const draftButton = await screen.findByRole('button', { name: 'Draft email' });
    fireEvent.click(draftButton);

    const recipientInput = await screen.findByPlaceholderText('hr@company.com');
    expect((recipientInput as HTMLInputElement).value).toBe('hr@acme.dev');
    expect(draftApplyEmail).toHaveBeenCalledWith('v1', 'Letter');
    expect(sendApplyEmail).not.toHaveBeenCalled();

    fireEvent.change(recipientInput, { target: { value: 'jobs@acme.dev' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send via Gmail' }));

    await waitFor(() =>
      expect(sendApplyEmail).toHaveBeenCalledWith('v1', {
        recipient: 'jobs@acme.dev',
        subject: 'Senior React Developer — application',
        body: 'Hello,\n\nLetter\n\nResume attached.',
      }),
    );
    await waitFor(() => expect(screen.getByText(/Sent via Gmail/)).toBeTruthy());
  });

  it('surfaces send errors', async () => {
    fetchGmailStatus.mockResolvedValue({ configured: true, connected: true });
    draftApplyEmail.mockResolvedValue({ recipient: 'hr@acme.dev', subject: 'S', body: 'B' });
    sendApplyEmail.mockRejectedValue(new Error('Gmail rejected the message — try again later'));

    render(<ApplyEmailSection detail={detail} coverLetter="Letter" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Draft email' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send via Gmail' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Gmail rejected the message'),
    );
  });
});
