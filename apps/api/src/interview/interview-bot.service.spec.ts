import { BadRequestException } from '@nestjs/common';
import type {
  InterviewPlanDetail,
  InterviewQuestionItem,
  InterviewSessionDetail,
} from '@jobradar/shared';

import type { OpenDialog } from '../bot/bot-dialogs';
import type {
  BotCallbackContext,
  BotCallbackHandler,
  BotCommandHandler,
  BotDialogHandler,
  BotMessageContext,
} from '../bot/bot.service';
import { InterviewBotService } from './interview-bot.service';

const QID = '11111111-2222-4333-8444-555555555555';
const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const PLAN: InterviewPlanDetail = {
  id: 'plan-1',
  targetRole: null,
  targetSeniority: null,
  focus: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  structure: {
    sections: [
      {
        title: 'Core',
        topics: [
          { key: 'js', title: 'JavaScript', why: 'Daily tool' },
          { key: 'sql', title: 'SQL', why: 'Data' },
        ],
      },
    ],
  },
  progress: [{ topicKey: 'js', status: 'done', confidence: null, updatedAt: '2026-10-01' }],
};

const QUESTION: InterviewQuestionItem = {
  id: QID,
  planId: 'plan-1',
  topic: 'SQL',
  kind: 'theory',
  difficulty: null,
  prompt: 'What is an index?',
  hasModelAnswer: false,
  modelAnswer: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

function session(overrides: Partial<InterviewSessionDetail> = {}): InterviewSessionDetail {
  return {
    id: SID,
    targetRole: null,
    targetSeniority: null,
    status: 'in_progress',
    transcript: [{ role: 'interviewer', content: 'Tell me about yourself.', at: 'x' }],
    feedback: null,
    startedAt: '2026-10-01T00:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

function setup() {
  let command: BotCommandHandler | undefined;
  let callback: BotCallbackHandler | undefined;
  let dialog: BotDialogHandler | undefined;
  const bot = {
    registerCommand: jest.fn((_: string, h: BotCommandHandler) => (command = h)),
    registerCallback: jest.fn((_: string, h: BotCallbackHandler) => (callback = h)),
    registerDialog: jest.fn((_: string, h: BotDialogHandler) => (dialog = h)),
    sendToUser: jest.fn().mockResolvedValue('77'),
    editMessage: jest.fn().mockResolvedValue(undefined),
  };
  const dialogs = {
    open: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const interview = {
    getActivePlan: jest.fn().mockResolvedValue(PLAN),
    generatePlan: jest.fn().mockResolvedValue(PLAN),
    updateProgress: jest.fn(),
    listQuestions: jest.fn().mockResolvedValue([]),
    generateQuestions: jest.fn(),
    revealModelAnswer: jest.fn(),
    reviewAnswer: jest.fn(),
    getActiveSession: jest.fn().mockResolvedValue(null),
    startSession: jest.fn(),
    reply: jest.fn(),
    finishSession: jest.fn(),
  };
  const service = new InterviewBotService(bot as never, dialogs as never, interview as never);
  service.onModuleInit();

  const owner: BotMessageContext = { userId: 'u1', chatId: 'c1', language: 'en', role: 'owner' };
  const press = (parts: string[], role: 'owner' | 'user' = 'owner') =>
    callback!({ ...owner, role, messageId: 5, parts } satisfies BotCallbackContext);
  const type = (text: string, open: OpenDialog, role: 'owner' | 'user' = 'owner') =>
    dialog!({ ...owner, role }, text, open);

  /** Texts of every message sent or edited, in order. */
  const texts = () => [
    ...bot.sendToUser.mock.calls.map((c) => c[1] as string),
    ...bot.editMessage.mock.calls.map((c) => c[2] as string),
  ];

  return { service, bot, dialogs, interview, owner, press, type, texts, command: () => command! };
}

describe('InterviewBotService', () => {
  it('registers /interview, the i namespace and its dialog flow', () => {
    const { bot } = setup();
    expect(bot.registerCommand).toHaveBeenCalledWith('interview', expect.any(Function));
    expect(bot.registerCallback).toHaveBeenCalledWith('i', expect.any(Function));
    expect(bot.registerDialog).toHaveBeenCalledWith('interview', expect.any(Function));
  });

  describe('owner gate (ADR-024 §3)', () => {
    it('answers a non-owner that the tool is the author’s, without calling the service', async () => {
      const { command, owner, bot, interview } = setup();
      await command()({ ...owner, role: 'user', language: 'ru' }, '');
      expect(bot.sendToUser.mock.calls[0]?.[1]).toContain('только автору');
      expect(interview.getActivePlan).not.toHaveBeenCalled();
    });

    it('refuses a non-owner’s button press and typed text', async () => {
      const { press, type, interview, dialogs, bot } = setup();
      expect(await press(['i', 'k'], 'user')).toEqual({
        alert: 'Interview prep is available to the JobRadar author only.',
      });
      await type(
        'hi',
        { userId: 'u1', flow: 'interview', step: 'mock', payload: { sessionId: SID } },
        'user',
      );
      expect(dialogs.close).toHaveBeenCalledWith('c1');
      expect(interview.reply).not.toHaveBeenCalled();
      expect(bot.sendToUser).toHaveBeenCalledTimes(1);
    });
  });

  it('opens the menu with progress, closing any open dialog', async () => {
    const { command, owner, bot, dialogs } = setup();
    await command()(owner, '');
    expect(dialogs.close).toHaveBeenCalledWith('c1');
    const [, text, options] = bot.sendToUser.mock.calls[0]!;
    expect(text).toContain('1 done, 0 in progress, 1 to do');
    expect(options.keyboard.flat().map((b: { text: string }) => b.text)).toContain('🗺 Topic plan');
  });

  it('changes a topic status and re-renders the topic', async () => {
    const { press, interview } = setup();
    interview.updateProgress.mockResolvedValue({
      topicKey: 'sql',
      status: 'in_progress',
      confidence: null,
      updatedAt: '2026-10-02',
    });
    const result = await press(['i', 's', '1', 'w']);
    expect(interview.updateProgress).toHaveBeenCalledWith('u1', 'plan-1', {
      topicKey: 'sql',
      status: 'in_progress',
    });
    expect(result).toMatchObject({ alert: 'Status: 🟡 In progress' });
    expect((result as { editText: string }).editText).toContain('Status: 🟡 In progress');
  });

  it('sends the menu back when there is no plan for the plan screen', async () => {
    const { press, interview } = setup();
    interview.getActivePlan.mockResolvedValue(null);
    const result = await press(['i', 'p', '0']);
    expect(result).toMatchObject({ alert: 'Build a topic plan first.' });
  });

  describe('questions by topic', () => {
    it('shows an existing question in place, without the LLM', async () => {
      const { press, interview } = setup();
      interview.listQuestions.mockResolvedValue([QUESTION]);
      const result = await press(['i', 'q', '1', '0']);
      expect(interview.listQuestions).toHaveBeenCalledWith('u1', {
        topic: 'SQL',
        planId: 'plan-1',
      });
      expect(interview.generateQuestions).not.toHaveBeenCalled();
      expect((result as { editText: string }).editText).toContain('What is an index?');
    });

    it('generates missing questions in the background, editing the pressed message', async () => {
      const { service, press, interview, bot } = setup();
      interview.listQuestions.mockResolvedValueOnce([]).mockResolvedValueOnce([QUESTION]);
      const result = await press(['i', 'q', '1', '0']);
      expect(result).toEqual({ alert: '⏳ Thinking…' });
      await service.settle();

      expect(interview.generateQuestions).toHaveBeenCalledWith('u1', {
        topic: 'SQL',
        planId: 'plan-1',
        kind: 'theory',
        count: 3,
      });
      expect(bot.editMessage.mock.calls.map((c) => [c[1], c[2]])).toEqual([
        [5, '⏳ Thinking…'],
        [5, expect.stringContaining('What is an index?')],
      ]);
    });

    it('sends the model answer as new messages, split when long', async () => {
      const { service, press, interview, bot } = setup();
      interview.revealModelAnswer.mockResolvedValue({
        modelAnswer: 'An index speeds up lookups. '.repeat(300),
        cached: false,
      });
      await press(['i', 'm', QID]);
      await service.settle();
      // The placeholder is edited with part one; the rest go as new messages.
      expect(bot.sendToUser.mock.calls[0]?.[1]).toBe('⏳ Thinking…');
      expect(bot.editMessage).toHaveBeenCalledWith(
        'c1',
        77,
        expect.stringContaining('Model answer'),
        expect.anything(),
      );
      expect(bot.sendToUser.mock.calls.length).toBeGreaterThan(1);
      for (const text of [...bot.sendToUser.mock.calls.map((c) => c[1] as string)]) {
        expect(text.length).toBeLessThanOrEqual(4096);
      }
    });

    it('routes a typed answer to the review and closes the dialog', async () => {
      const { service, press, type, interview, dialogs, bot } = setup();
      await press(['i', 'a', '1', '0', QID]);
      expect(dialogs.open).toHaveBeenCalledWith('c1', {
        userId: 'u1',
        flow: 'interview',
        step: 'answer',
        payload: { questionId: QID, index: 1, n: 0 },
      });

      interview.reviewAnswer.mockResolvedValue({
        answerId: 'a1',
        score: 0.8,
        review: {
          verdict: 'Good',
          correctness: 'ok',
          complexity: 'ok',
          style: 'ok',
          suggestions: [],
        },
      });
      await type('  A B-tree on a column  ', {
        userId: 'u1',
        flow: 'interview',
        step: 'answer',
        payload: { questionId: QID, index: 1, n: 0 },
      });
      await service.settle();

      expect(interview.reviewAnswer).toHaveBeenCalledWith('u1', QID, 'A B-tree on a column');
      expect(dialogs.close).toHaveBeenCalledWith('c1');
      const [, , text, options] = bot.editMessage.mock.calls[0]!;
      expect(text).toContain('Review: 8/10');
      expect(options.keyboard.flat().map((b: { callbackData: string }) => b.callbackData)).toEqual([
        'i:q:1:1',
        'i:qp:0',
      ]);
    });

    it('turns an LLM failure into a friendly message', async () => {
      const { service, type, interview, bot } = setup();
      interview.reviewAnswer.mockRejectedValue(new Error('provider timeout'));
      await type('answer', {
        userId: 'u1',
        flow: 'interview',
        step: 'answer',
        payload: { questionId: QID, index: 0, n: 0 },
      });
      await service.settle();
      expect(bot.editMessage.mock.calls[0]?.[2]).toBe(
        'The AI did not answer this time. Try again in a minute.',
      );
    });
  });

  describe('mock interview', () => {
    it('starts a session, opens the dialog and sends the opening with finish / pause', async () => {
      const { service, press, interview, dialogs, bot } = setup();
      interview.startSession.mockResolvedValue(session());
      expect(await press(['i', 'k'])).toEqual({ alert: '⏳ Thinking…' });
      await service.settle();

      expect(interview.startSession).toHaveBeenCalledWith('u1', { planId: 'plan-1' });
      expect(dialogs.open).toHaveBeenCalledWith('c1', {
        userId: 'u1',
        flow: 'interview',
        step: 'mock',
        payload: { sessionId: SID },
      });
      const [, , text, options] = bot.editMessage.mock.calls[0]!;
      expect(text).toContain('Tell me about yourself.');
      expect(options.keyboard).toEqual([
        [
          { text: '🏁 Finish', callbackData: `i:f:${SID}` },
          { text: '⏸ Pause', callbackData: `i:z:${SID}` },
        ],
      ]);
    });

    it('resumes the active session without the LLM', async () => {
      const { press, interview, bot } = setup();
      interview.getActiveSession.mockResolvedValue(session());
      expect(await press(['i', 'k'])).toEqual({});
      expect(interview.startSession).not.toHaveBeenCalled();
      expect(bot.sendToUser.mock.calls[0]?.[1]).toContain('Tell me about yourself.');
    });

    it('asks to upload a resume when there is none', async () => {
      const { service, press, interview, texts } = setup();
      interview.startSession.mockRejectedValue(
        new BadRequestException('Upload a resume first — the interview is based on it'),
      );
      await press(['i', 'k']);
      await service.settle();
      expect(texts()).toContain(
        'Upload your resume first (send the PDF here): this is built from it.',
      );
    });

    it('sends every typed message as a reply and refreshes the dialog', async () => {
      const { service, type, interview, dialogs, bot } = setup();
      interview.reply.mockResolvedValue(
        session({
          transcript: [
            { role: 'interviewer', content: 'Tell me about yourself.', at: 'x' },
            { role: 'candidate', content: 'I build APIs.', at: 'y' },
            { role: 'interviewer', content: 'Which database?', at: 'z' },
          ],
        }),
      );
      await type('I build APIs.', {
        userId: 'u1',
        flow: 'interview',
        step: 'mock',
        payload: { sessionId: SID },
      });
      await service.settle();
      expect(interview.reply).toHaveBeenCalledWith('u1', SID, 'I build APIs.');
      expect(dialogs.open).toHaveBeenCalledTimes(1);
      expect(bot.editMessage.mock.calls[0]?.[2]).toContain('Which database?');
    });

    it('finishes: sends the feedback and closes the dialog', async () => {
      const { service, press, interview, dialogs, bot } = setup();
      interview.finishSession.mockResolvedValue(
        session({
          status: 'completed',
          feedback: {
            summary: 'Solid',
            strengths: ['Clear'],
            gaps: ['Depth'],
            recommendation: 'Practise SQL',
            score: 0.7,
          },
        }),
      );
      expect(await press(['i', 'f', SID])).toEqual({ alert: '⏳ Thinking…', editKeyboard: null });
      await service.settle();
      expect(interview.finishSession).toHaveBeenCalledWith('u1', SID);
      expect(dialogs.close).toHaveBeenCalledWith('c1');
      expect(bot.editMessage.mock.calls[0]?.[2]).toContain('Interview finished: 7/10');
    });

    it('keeps the session open when finishing fails, with the buttons back', async () => {
      const { service, press, interview, dialogs, bot } = setup();
      interview.finishSession.mockRejectedValue(
        new BadRequestException('Answer at least one question before ending the interview'),
      );
      await press(['i', 'f', SID]);
      await service.settle();
      expect(dialogs.close).not.toHaveBeenCalled();
      const [, , text, options] = bot.editMessage.mock.calls[0]!;
      expect(text).toBe('Answer at least one question before finishing the interview.');
      expect(options.keyboard[0][0].callbackData).toBe(`i:f:${SID}`);
    });

    it('pauses: closes the dialog and offers to resume', async () => {
      const { press, dialogs, bot, interview } = setup();
      expect(await press(['i', 'z', SID])).toEqual({ editKeyboard: null });
      expect(dialogs.close).toHaveBeenCalledWith('c1');
      expect(interview.finishSession).not.toHaveBeenCalled();
      const [, text, options] = bot.sendToUser.mock.calls[0]!;
      expect(text).toContain('Paused');
      expect(options.keyboard[0][0].callbackData).toBe('i:k');
    });
  });
});
