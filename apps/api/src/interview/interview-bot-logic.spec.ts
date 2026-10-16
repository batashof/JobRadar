import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  InterviewPlanDetail,
  InterviewQuestionItem,
  InterviewTopicStatus,
} from '@jobradar/shared';

import type { InlineKeyboard } from '../bot/telegram-api';
import {
  errorKey,
  flattenTopics,
  MESSAGE_LIMIT,
  orderQuestions,
  parseCallback,
  progressCounts,
  renderFeedback,
  renderInterviewer,
  renderMenu,
  renderPlan,
  renderQuestion,
  renderReview,
  renderTopic,
  renderTopicPicker,
  splitMessage,
  TOPICS_PER_PAGE,
} from './interview-bot-logic';

const QID = '11111111-2222-4333-8444-555555555555';
const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function plan(
  topicCount = 3,
  progress: { topicKey: string; status: InterviewTopicStatus }[] = [],
): InterviewPlanDetail {
  const topics = Array.from({ length: topicCount }, (_, i) => ({
    key: `t${i}`,
    title: `Topic <${i}>`,
    why: `Because ${i}`,
  }));
  return {
    id: 'plan-1',
    targetRole: null,
    targetSeniority: null,
    focus: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    structure: {
      sections: [
        { title: 'Core', topics: topics.slice(0, 2) },
        { title: 'Extra', topics: topics.slice(2) },
      ],
    },
    progress: progress.map((p) => ({ ...p, confidence: null, updatedAt: '2026-10-01T00:00:00Z' })),
  };
}

function question(
  id: string,
  createdAt: string,
  prompt = 'What is a closure?',
): InterviewQuestionItem {
  return {
    id,
    planId: 'plan-1',
    topic: 'Topic',
    kind: 'theory',
    difficulty: null,
    prompt,
    hasModelAnswer: false,
    modelAnswer: null,
    createdAt,
  };
}

const allButtons = (keyboard: InlineKeyboard) => keyboard.flat();

function expectValidKeyboard(keyboard: InlineKeyboard) {
  for (const row of keyboard) expect(row.length).toBeLessThanOrEqual(2);
  for (const button of allButtons(keyboard)) {
    expect(Buffer.byteLength(button.callbackData ?? '', 'utf8')).toBeLessThanOrEqual(64);
    // Every button names its action behind an icon.
    expect(button.text).toMatch(/^\S+\s+\S/u);
  }
}

describe('interview bot logic — plan data', () => {
  it('flattens sections in order and defaults topics to todo', () => {
    const topics = flattenTopics(plan(3, [{ topicKey: 't2', status: 'done' }]));
    expect(topics.map((t) => [t.key, t.section, t.status])).toEqual([
      ['t0', 'Core', 'todo'],
      ['t1', 'Core', 'todo'],
      ['t2', 'Extra', 'done'],
    ]);
  });

  it('counts todo / in progress / done', () => {
    const counts = progressCounts(
      plan(3, [
        { topicKey: 't0', status: 'in_progress' },
        { topicKey: 't1', status: 'done' },
      ]),
    );
    expect(counts).toEqual({ todo: 1, in_progress: 1, done: 1 });
  });

  it('orders questions oldest first, breaking timestamp ties by id', () => {
    const ordered = orderQuestions([
      question('c', '2026-10-02T00:00:00Z'),
      question('b', '2026-10-01T00:00:00Z'),
      question('a', '2026-10-01T00:00:00Z'),
    ]);
    expect(ordered.map((q) => q.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('interview bot logic — screens', () => {
  it('menu shows progress and the three tools when a plan exists', () => {
    const screen = renderMenu('en', plan(3, [{ topicKey: 't0', status: 'done' }]), false);
    expect(screen.text).toContain('1 done, 0 in progress, 2 to do');
    expect(allButtons(screen.keyboard).map((b) => b.text)).toEqual([
      '🎤 Mock interview',
      '📚 Questions by topic',
      '🗺 Topic plan',
    ]);
    expectValidKeyboard(screen.keyboard);
  });

  it('menu offers to build a plan, and to resume a paused interview, in Russian', () => {
    const screen = renderMenu('ru', null, true);
    expect(screen.text).toContain('Плана тем пока нет');
    expect(allButtons(screen.keyboard).map((b) => [b.text, b.callbackData])).toEqual([
      ['▶️ Продолжить собеседование', 'i:k'],
      ['🗺 Собрать план тем', 'i:g'],
    ]);
  });

  it('plan lists topics with status, escaped, and pages long plans', () => {
    const big = plan(TOPICS_PER_PAGE + 3, [{ topicKey: 't0', status: 'in_progress' }]);
    const first = renderPlan('en', big, 0);
    expect(first.text).toContain('🟡 1. Topic &lt;0&gt;');
    expect(first.text).toContain('<b>Core</b>');
    expect(first.text).toContain('Page 1 of 2.');
    const buttons = allButtons(first.keyboard);
    expect(buttons.filter((b) => b.callbackData?.startsWith('i:t:'))).toHaveLength(TOPICS_PER_PAGE);
    expect(buttons.map((b) => b.callbackData)).toEqual(expect.arrayContaining(['i:p:1', 'i:h']));
    expectValidKeyboard(first.keyboard);

    const second = renderPlan('en', big, 9);
    expect(second.text).toContain('Page 2 of 2.');
    expect(allButtons(second.keyboard).map((b) => b.callbackData)).toContain('i:p:0');
  });

  it('topic screen has status buttons with words, the current one marked, and back', () => {
    const screen = renderTopic('en', plan(3, [{ topicKey: 't1', status: 'done' }]), 1);
    expect(screen?.text).toContain('Status: ✅ Done');
    expect(allButtons(screen!.keyboard).map((b) => [b.text, b.callbackData])).toEqual([
      ['⚪ To do', 'i:s:1:o'],
      ['🟡 In progress', 'i:s:1:w'],
      ['✅ Done (now)', 'i:s:1:d'],
      ['⬅️ Back', 'i:p:0'],
      ['🏠 Menu', 'i:h'],
    ]);
    expect(renderTopic('en', plan(3), 7)).toBeNull();
  });

  it('topic picker opens the first question of a topic', () => {
    const screen = renderTopicPicker('ru', plan(3), 0);
    expect(screen.text).toContain('Выбери тему');
    expect(allButtons(screen.keyboard)[2]?.callbackData).toBe('i:q:2:0');
  });

  it('question screen carries model answer, answer, next and back', () => {
    const screen = renderQuestion('en', 'Closures', 4, 1, question(QID, '2026-10-01T00:00:00Z'));
    expect(screen.text).toContain('Question 2');
    expect(screen.text).toContain('What is a closure?');
    expect(allButtons(screen.keyboard).map((b) => [b.text, b.callbackData])).toEqual([
      ['💡 Model answer', `i:m:${QID}`],
      ['✍️ Answer it', `i:a:4:1:${QID}`],
      ['➡️ Next question', 'i:q:4:2'],
      ['⬅️ Back', 'i:qp:0'],
    ]);
    expectValidKeyboard(screen.keyboard);
  });

  it('cuts a giant question to one message', () => {
    const long = 'word '.repeat(2000);
    const screen = renderQuestion('en', 'T', 0, 0, question(QID, '2026-10-01T00:00:00Z', long));
    expect(screen.text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(screen.text.endsWith('…')).toBe(true);
  });
});

describe('interview bot logic — long output', () => {
  it('splits long text into messages within the limit, escaping every part', () => {
    const body = Array.from({ length: 400 }, (_, i) => `Line ${i} <tag> & more text here.`).join(
      '\n',
    );
    const parts = splitMessage('<b>Head</b>\n\n', body);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]?.startsWith('<b>Head</b>')).toBe(true);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
      expect(part).not.toContain('<tag>');
    }
    expect(parts.join(' ')).toContain('Line 399');
  });

  it('renders a review with score out of 10 and the suggestions', () => {
    const [text] = renderReview('en', {
      answerId: 'a1',
      score: 0.75,
      review: {
        verdict: 'Mostly right',
        correctness: 'Correct',
        complexity: 'O(n)',
        style: 'Fine',
        suggestions: ['Mention edge cases'],
      },
    });
    expect(text).toContain('Review: 7.5/10');
    expect(text).toContain('• Mention edge cases');
  });

  it('renders the interview feedback in Russian', () => {
    const [text] = renderFeedback('ru', {
      summary: 'Неплохо',
      strengths: ['Структура'],
      gaps: ['SQL'],
      recommendation: 'Подтянуть SQL',
      score: 0.6,
    });
    expect(text).toContain('Собеседование завершено: 6/10');
    expect(text).toContain('• SQL');
    expect(text).toContain('Подтянуть SQL');
  });

  it('adds the reply hint to the interviewer message', () => {
    const parts = renderInterviewer('en', 'Tell me about yourself.');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('Tell me about yourself.');
    expect(parts[0]).toContain('🏁 Finish');
  });
});

describe('interview bot logic — errors and callbacks', () => {
  it('maps service errors to friendly messages', () => {
    expect(
      errorKey(new BadRequestException('Upload a resume first — the plan is built from it')),
    ).toBe('noResume');
    expect(
      errorKey(new BadRequestException('Answer at least one question before ending the interview')),
    ).toBe('answerFirst');
    expect(errorKey(new BadRequestException('This interview has already ended'))).toBe('ended');
    expect(errorKey(new Error('LLM provider timeout'))).toBe('failed');
    expect(errorKey(new NotFoundException('Question not found'))).toBe('failed');
  });

  it('parses every action', () => {
    expect(parseCallback(['i', 'h'])).toEqual({ kind: 'menu' });
    expect(parseCallback(['i', 'g'])).toEqual({ kind: 'buildPlan' });
    expect(parseCallback(['i', 'k'])).toEqual({ kind: 'mock' });
    expect(parseCallback(['i', 'p', '2'])).toEqual({ kind: 'plan', page: 2 });
    expect(parseCallback(['i', 'qp', '0'])).toEqual({ kind: 'pickTopic', page: 0 });
    expect(parseCallback(['i', 't', '5'])).toEqual({ kind: 'topic', index: 5 });
    expect(parseCallback(['i', 's', '5', 'w'])).toEqual({
      kind: 'status',
      index: 5,
      status: 'in_progress',
    });
    expect(parseCallback(['i', 'q', '3', '4'])).toEqual({ kind: 'question', index: 3, n: 4 });
    expect(parseCallback(['i', 'm', QID])).toEqual({ kind: 'modelAnswer', questionId: QID });
    expect(parseCallback(['i', 'a', '3', '4', QID])).toEqual({
      kind: 'answer',
      index: 3,
      n: 4,
      questionId: QID,
    });
    expect(parseCallback(['i', 'f', SID])).toEqual({ kind: 'finish', sessionId: SID });
    expect(parseCallback(['i', 'z', SID])).toEqual({ kind: 'pause', sessionId: SID });
  });

  it('rejects malformed or foreign data', () => {
    expect(parseCallback(['j', 'h'])).toBeNull();
    expect(parseCallback(['i', 'x'])).toBeNull();
    expect(parseCallback(['i', 'p', '-1'])).toBeNull();
    expect(parseCallback(['i', 's', '1', 'q'])).toBeNull();
    expect(parseCallback(['i', 'q', '1'])).toBeNull();
    expect(parseCallback(['i', 'm', 'not-a-uuid'])).toBeNull();
    expect(parseCallback(['i', 'a', '1', '2'])).toBeNull();
    expect(parseCallback(['i', 'f'])).toBeNull();
  });
});
