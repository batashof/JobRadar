import type { InterviewPlanDetail, InterviewQuestionItem } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  generateInterviewPlan,
  generateQuestions,
  listQuestions,
  reviewAnswer,
  revealModelAnswer,
  updateTopicProgress,
} = vi.hoisted(() => ({
  generateInterviewPlan: vi.fn(),
  generateQuestions: vi.fn(),
  listQuestions: vi.fn(),
  reviewAnswer: vi.fn(),
  revealModelAnswer: vi.fn(),
  updateTopicProgress: vi.fn(),
}));

vi.mock('@/lib/interview', () => ({
  generateInterviewPlan,
  generateQuestions,
  listQuestions,
  reviewAnswer,
  revealModelAnswer,
  updateTopicProgress,
}));

import { InterviewWorkspace } from './interview-workspace';

const plan: InterviewPlanDetail = {
  id: 'plan-1',
  targetRole: 'Senior Frontend',
  targetSeniority: 'senior',
  focus: ['React'],
  createdAt: '2026-07-21T00:00:00.000Z',
  structure: {
    sections: [
      {
        title: 'JavaScript core',
        topics: [{ key: 'event-loop', title: 'Event loop', why: 'async questions' }],
      },
    ],
  },
  progress: [],
};

describe('InterviewWorkspace', () => {
  afterEach(() => vi.clearAllMocks());

  it('generates a plan from the form when none exists', async () => {
    generateInterviewPlan.mockResolvedValue(plan);
    render(<InterviewWorkspace initialPlan={null} />);

    fireEvent.change(screen.getByLabelText('Seniority'), { target: { value: 'senior' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate plan' }));

    await waitFor(() => expect(screen.getByText('JavaScript core')).toBeTruthy());
    expect(generateInterviewPlan).toHaveBeenCalledWith(
      expect.objectContaining({ targetSeniority: 'senior' }),
    );
  });

  it('renders the plan and persists topic progress changes', async () => {
    updateTopicProgress.mockResolvedValue({
      topicKey: 'event-loop',
      status: 'done',
      confidence: null,
      updatedAt: '2026-07-21T01:00:00.000Z',
    });
    render(<InterviewWorkspace initialPlan={plan} />);

    expect(screen.getByText('Event loop')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Progress: Event loop'), { target: { value: 'done' } });

    await waitFor(() =>
      expect(updateTopicProgress).toHaveBeenCalledWith('plan-1', {
        topicKey: 'event-loop',
        status: 'done',
      }),
    );
    await waitFor(() => expect(screen.getByText('1/1 topics done')).toBeTruthy());
  });

  it('opens a topic drill and generates questions', async () => {
    listQuestions.mockResolvedValue([]);
    const created: InterviewQuestionItem[] = [
      {
        id: 'q1',
        planId: 'plan-1',
        topic: 'Event loop',
        kind: 'theory',
        difficulty: 'middle',
        prompt: 'What is the microtask queue?',
        hasModelAnswer: false,
        modelAnswer: null,
        createdAt: '2026-07-21T02:00:00.000Z',
      },
    ];
    generateQuestions.mockResolvedValue(created);
    revealModelAnswer.mockResolvedValue({ modelAnswer: 'A queue of microtasks.', cached: false });

    render(<InterviewWorkspace initialPlan={plan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Event loop' }));

    await waitFor(() => expect(listQuestions).toHaveBeenCalledWith({ topic: 'Event loop', planId: 'plan-1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Generate questions' }));
    await waitFor(() => expect(screen.getByText('What is the microtask queue?')).toBeTruthy());

    // Reveal the model answer for a theory question.
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await waitFor(() => expect(screen.getByText('A queue of microtasks.')).toBeTruthy());
    expect(revealModelAnswer).toHaveBeenCalledWith('q1');
  });

  it('reviews a live-coding solution without executing it', async () => {
    const coding: InterviewQuestionItem[] = [
      {
        id: 'c1',
        planId: 'plan-1',
        topic: 'Event loop',
        kind: 'coding',
        difficulty: 'middle',
        prompt: 'Implement a debounce.',
        hasModelAnswer: false,
        modelAnswer: null,
        createdAt: '2026-07-21T02:00:00.000Z',
      },
    ];
    listQuestions.mockResolvedValue(coding);
    reviewAnswer.mockResolvedValue({
      answerId: 'a1',
      score: 0.75,
      review: {
        verdict: 'Works',
        correctness: 'handles trailing calls',
        complexity: 'O(1)',
        style: 'clean',
        suggestions: ['add types'],
      },
    });

    render(<InterviewWorkspace initialPlan={plan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Event loop' }));

    const textarea = await screen.findByLabelText('Your solution');
    fireEvent.change(textarea, { target: { value: 'const debounce = () => {}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review my solution' }));

    await waitFor(() => expect(screen.getByText('Works')).toBeTruthy());
    expect(reviewAnswer).toHaveBeenCalledWith('c1', 'const debounce = () => {}');
    expect(screen.getByText(/add types/)).toBeTruthy();
  });
});
