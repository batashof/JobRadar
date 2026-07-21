import type {
  GeneratePlanInput,
  GenerateQuestionsInput,
  InterviewAnswerReview,
  InterviewModelAnswerResponse,
  InterviewPlanDetail,
  InterviewQuestionItem,
  InterviewSessionDetail,
  InterviewTopicProgressItem,
  StartSessionInput,
  UpdateTopicProgressInput,
} from '@jobradar/shared';

import { apiFetch } from './api';

export function getInterviewPlan(): Promise<InterviewPlanDetail | null> {
  return apiFetch<InterviewPlanDetail | null>('/interview/plan');
}

export function generateInterviewPlan(input: GeneratePlanInput): Promise<InterviewPlanDetail> {
  return apiFetch<InterviewPlanDetail>('/interview/plan', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTopicProgress(
  planId: string,
  input: UpdateTopicProgressInput,
): Promise<InterviewTopicProgressItem> {
  return apiFetch<InterviewTopicProgressItem>(`/interview/plan/${planId}/progress`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function listQuestions(params: {
  topic?: string;
  planId?: string;
}): Promise<InterviewQuestionItem[]> {
  const query = new URLSearchParams();
  if (params.topic) query.set('topic', params.topic);
  if (params.planId) query.set('planId', params.planId);
  const qs = query.toString();
  return apiFetch<InterviewQuestionItem[]>(`/interview/questions${qs ? `?${qs}` : ''}`);
}

export function generateQuestions(input: GenerateQuestionsInput): Promise<InterviewQuestionItem[]> {
  return apiFetch<InterviewQuestionItem[]>('/interview/questions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revealModelAnswer(questionId: string): Promise<InterviewModelAnswerResponse> {
  return apiFetch<InterviewModelAnswerResponse>(`/interview/questions/${questionId}/model-answer`, {
    method: 'POST',
  });
}

export function reviewAnswer(questionId: string, answer: string): Promise<InterviewAnswerReview> {
  return apiFetch<InterviewAnswerReview>(`/interview/questions/${questionId}/review`, {
    method: 'POST',
    body: JSON.stringify({ answer }),
  });
}

// Mock interview (text chat) --------------------------------------------------

export function startSession(input: StartSessionInput): Promise<InterviewSessionDetail> {
  return apiFetch<InterviewSessionDetail>('/interview/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function replyToSession(
  sessionId: string,
  answer: string,
): Promise<InterviewSessionDetail> {
  return apiFetch<InterviewSessionDetail>(`/interview/sessions/${sessionId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ answer }),
  });
}

export function finishSession(sessionId: string): Promise<InterviewSessionDetail> {
  return apiFetch<InterviewSessionDetail>(`/interview/sessions/${sessionId}/finish`, {
    method: 'POST',
  });
}
