import type { InterviewSessionDetail } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { startSession, replyToSession, finishSession } = vi.hoisted(() => ({
  startSession: vi.fn(),
  replyToSession: vi.fn(),
  finishSession: vi.fn(),
}));

vi.mock('@/lib/interview', () => ({ startSession, replyToSession, finishSession }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { InterviewMock } from './interview-mock';

const inProgress: InterviewSessionDetail = {
  id: 's1',
  targetRole: 'Senior Frontend',
  targetSeniority: 'senior',
  status: 'in_progress',
  transcript: [
    { role: 'interviewer', content: 'Hi! Tell me about a hard bug you fixed.', at: '2026-07-21T00:00:00.000Z' },
  ],
  feedback: null,
  startedAt: '2026-07-21T00:00:00.000Z',
  endedAt: null,
};

describe('InterviewMock', () => {
  afterEach(() => vi.clearAllMocks());

  it('starts a session from the form and shows the interviewer opening', async () => {
    startSession.mockResolvedValue(inProgress);
    render(<InterviewMock initialSession={null} />);

    fireEvent.change(screen.getByLabelText('Target role'), {
      target: { value: 'Senior Frontend' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start interview' }));

    await waitFor(() =>
      expect(screen.getByText('Hi! Tell me about a hard bug you fixed.')).toBeTruthy(),
    );
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetRole: 'Senior Frontend' }),
    );
  });

  it('sends an answer and appends the next interviewer turn', async () => {
    replyToSession.mockResolvedValue({
      ...inProgress,
      transcript: [
        ...inProgress.transcript,
        { role: 'candidate', content: 'A race condition in a cache.', at: '2026-07-21T00:01:00.000Z' },
        { role: 'interviewer', content: 'How did you diagnose it?', at: '2026-07-21T00:02:00.000Z' },
      ],
    });
    render(<InterviewMock initialSession={inProgress} />);

    fireEvent.change(screen.getByLabelText('Your answer'), {
      target: { value: 'A race condition in a cache.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    await waitFor(() => expect(screen.getByText('How did you diagnose it?')).toBeTruthy());
    expect(replyToSession).toHaveBeenCalledWith('s1', 'A race condition in a cache.');
    expect(screen.getByText('A race condition in a cache.')).toBeTruthy();
  });

  it('finishes the interview and shows the feedback report', async () => {
    finishSession.mockResolvedValue({
      ...inProgress,
      status: 'completed',
      endedAt: '2026-07-21T00:10:00.000Z',
      feedback: {
        summary: 'Strong practical grounding.',
        strengths: ['Clear debugging story'],
        gaps: ['Shaky on system design'],
        recommendation: 'Practise scaling questions.',
        score: 0.72,
      },
    });
    render(<InterviewMock initialSession={inProgress} />);

    fireEvent.click(screen.getByRole('button', { name: 'Finish & get feedback' }));

    await waitFor(() => expect(screen.getByTestId('feedback')).toBeTruthy());
    expect(screen.getByText('Strong practical grounding.')).toBeTruthy();
    expect(screen.getByText('Clear debugging story')).toBeTruthy();
    expect(finishSession).toHaveBeenCalledWith('s1');
    // The answer box is gone once the interview is completed.
    expect(screen.queryByLabelText('Your answer')).toBeNull();
  });
});
