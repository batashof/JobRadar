import type {
  AuthUser,
  InterviewAnswerReview,
  InterviewPlanDetail,
  InterviewQuestionItem,
  InterviewSessionDetail,
} from '@jobradar/shared';

import { InterviewController } from './interview.controller';
import type { InterviewService } from './interview.service';

const user: AuthUser = { id: 'user-1', email: 'dev@jobradar.local', digestEnabled: true, language: 'ru' };

describe('InterviewController', () => {
  it('delegates fetching the active plan', async () => {
    const detail = { id: 'p1' } as InterviewPlanDetail;
    const getActivePlan = jest.fn().mockResolvedValue(detail);
    const controller = new InterviewController({ getActivePlan } as unknown as InterviewService);

    await expect(controller.getPlan(user)).resolves.toBe(detail);
    expect(getActivePlan).toHaveBeenCalledWith(user.id);
  });

  it('delegates plan generation with the body', async () => {
    const detail = { id: 'p1' } as InterviewPlanDetail;
    const generatePlan = jest.fn().mockResolvedValue(detail);
    const controller = new InterviewController({ generatePlan } as unknown as InterviewService);
    const body = { targetRole: 'Senior Frontend' };

    await expect(controller.generatePlan(user, body)).resolves.toBe(detail);
    expect(generatePlan).toHaveBeenCalledWith(user.id, body);
  });

  it('delegates a progress update to the owning user + plan', async () => {
    const updateProgress = jest.fn().mockResolvedValue({ topicKey: 't', status: 'done' });
    const controller = new InterviewController({ updateProgress } as unknown as InterviewService);
    const body = { topicKey: 'event-loop', status: 'done' as const, confidence: 4 };

    await controller.updateProgress(user, 'plan-1', body);
    expect(updateProgress).toHaveBeenCalledWith(user.id, 'plan-1', body);
  });

  it('delegates question generation and listing', async () => {
    const items = [{ id: 'q1' }] as InterviewQuestionItem[];
    const generateQuestions = jest.fn().mockResolvedValue(items);
    const listQuestions = jest.fn().mockResolvedValue(items);
    const controller = new InterviewController({
      generateQuestions,
      listQuestions,
    } as unknown as InterviewService);

    const body = { topic: 'React', kind: 'theory' as const };
    await expect(controller.generateQuestions(user, body)).resolves.toBe(items);
    expect(generateQuestions).toHaveBeenCalledWith(user.id, body);

    await controller.listQuestions(user, 'React', 'plan-1');
    expect(listQuestions).toHaveBeenCalledWith(user.id, { topic: 'React', planId: 'plan-1' });
  });

  it('delegates model-answer reveal and answer review', async () => {
    const revealModelAnswer = jest.fn().mockResolvedValue({ modelAnswer: 'A', cached: false });
    const review: InterviewAnswerReview = {
      answerId: 'a1',
      score: 0.8,
      review: { verdict: 'ok', correctness: '', complexity: '', style: '', suggestions: [] },
    };
    const reviewAnswer = jest.fn().mockResolvedValue(review);
    const controller = new InterviewController({
      revealModelAnswer,
      reviewAnswer,
    } as unknown as InterviewService);

    await controller.revealModelAnswer(user, 'q1');
    expect(revealModelAnswer).toHaveBeenCalledWith(user.id, 'q1');

    await expect(controller.reviewAnswer(user, 'q1', { answer: 'my solution' })).resolves.toBe(
      review,
    );
    expect(reviewAnswer).toHaveBeenCalledWith(user.id, 'q1', 'my solution');
  });

  it('delegates mock-interview start, active lookup, reply and finish', async () => {
    const detail = { id: 's1', status: 'in_progress' } as InterviewSessionDetail;
    const startSession = jest.fn().mockResolvedValue(detail);
    const getActiveSession = jest.fn().mockResolvedValue(detail);
    const getSession = jest.fn().mockResolvedValue(detail);
    const reply = jest.fn().mockResolvedValue(detail);
    const finishSession = jest.fn().mockResolvedValue(detail);
    const controller = new InterviewController({
      startSession,
      getActiveSession,
      getSession,
      reply,
      finishSession,
    } as unknown as InterviewService);

    await controller.startSession(user, { targetRole: 'Senior Frontend' });
    expect(startSession).toHaveBeenCalledWith(user.id, { targetRole: 'Senior Frontend' });

    await controller.getActiveSession(user);
    expect(getActiveSession).toHaveBeenCalledWith(user.id);

    await controller.getSession(user, 's1');
    expect(getSession).toHaveBeenCalledWith(user.id, 's1');

    await controller.reply(user, 's1', { answer: 'my answer' });
    expect(reply).toHaveBeenCalledWith(user.id, 's1', 'my answer');

    await controller.finishSession(user, 's1');
    expect(finishSession).toHaveBeenCalledWith(user.id, 's1');
  });
});
