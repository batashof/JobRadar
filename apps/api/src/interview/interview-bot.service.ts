import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { BOT_CALLBACK_NAMESPACES, isOwnerRole, type Language } from '@jobradar/shared';

import { BotDialogs, type OpenDialog } from '../bot/bot-dialogs';
import {
  type BotCallbackContext,
  type BotCallbackResult,
  type BotMessageContext,
  BotService,
} from '../bot/bot.service';
import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';
import {
  DIALOG_FLOW,
  DIALOG_STEPS,
  errorKey,
  flattenTopics,
  type InterviewTextKey,
  interviewText,
  menuKeyboard,
  mockKeyboard,
  orderQuestions,
  pausedKeyboard,
  parseCallback,
  QUESTIONS_PER_BATCH,
  renderAnswerPrompt,
  renderFeedback,
  renderInterviewer,
  renderMenu,
  renderModelAnswer,
  renderPlan,
  renderQuestion,
  renderReview,
  renderTopic,
  renderTopicPicker,
  reviewKeyboard,
  type Screen,
  statusLabel,
} from './interview-bot-logic';
import { InterviewService } from './interview.service';

/** What a background LLM step ends up sending: one or more messages, buttons on the last. */
interface Delivery {
  parts: string[];
  keyboard?: InlineKeyboard;
}

/** Who a background step reports to, and where the "thinking…" placeholder goes. */
interface Target {
  userId: string;
  chatId: string;
  language: Language;
  /** Edit this message instead of sending a new placeholder. */
  editMessageId?: number;
}

/** Longest typed answer passed on, matching the REST schemas. */
const MAX_ANSWER = 20_000;
const MAX_REPLY = 8_000;

/**
 * `/interview` in the bot (roadmap 5.5): the interview-prep tools that lived on
 * the website — the topic plan with progress, questions by topic with a model
 * answer and a review of the user's own answer, and the mock interview.
 *
 * Owner only (ADR-024 §3): every step is an LLM call per action. Everything
 * goes through `InterviewService`, the same code the web pages used.
 *
 * LLM calls take longer than Telegram's callback answer window and than a
 * webhook should be held, so they run in the background: the bot posts
 * "⏳ Thinking…" at once and replaces it with the answer (or a friendly error)
 * when the model replies, as the in-chat apply flow does.
 */
@Injectable()
export class InterviewBotService implements OnModuleInit {
  private readonly logger = new Logger(InterviewBotService.name);
  private readonly tasks = new Set<Promise<void>>();

  constructor(
    private readonly bot: BotService,
    private readonly dialogs: BotDialogs,
    private readonly interview: InterviewService,
  ) {}

  onModuleInit(): void {
    this.bot.registerCommand('interview', (ctx) => this.showMenu(ctx));
    this.bot.registerCallback(BOT_CALLBACK_NAMESPACES.interview, (ctx) => this.onCallback(ctx));
    this.bot.registerDialog(DIALOG_FLOW, (ctx, text, dialog) => this.onTyped(ctx, text, dialog));
  }

  /** Resolves once every background LLM step has finished (tests, shutdown). */
  async settle(): Promise<void> {
    while (this.tasks.size > 0) await Promise.all([...this.tasks]);
  }

  private async showMenu(ctx: BotMessageContext): Promise<void> {
    if (!isOwnerRole(ctx.role)) {
      await this.bot.sendToUser(ctx.userId, escapeHtml(interviewText(ctx.language, 'ownerOnly')));
      return;
    }
    // Opening the menu pauses a mock interview whose dialog is still open.
    await this.dialogs.close(ctx.chatId);
    const screen = await this.menuScreen(ctx.userId, ctx.language);
    await this.bot.sendToUser(ctx.userId, screen.text, {
      parseMode: 'HTML',
      keyboard: screen.keyboard,
    });
  }

  private async onCallback(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    if (!isOwnerRole(ctx.role)) return { alert: interviewText(ctx.language, 'ownerOnly') };
    const action = parseCallback(ctx.parts);
    if (!action) return {};
    const lang = ctx.language;
    const thinking = { alert: interviewText(lang, 'thinking') };

    switch (action.kind) {
      case 'menu':
        await this.dialogs.close(ctx.chatId);
        return this.edit(await this.menuScreen(ctx.userId, lang));

      case 'buildPlan':
        this.think(ctx, async () => {
          const plan = await this.interview.generatePlan(ctx.userId, {});
          const active = await this.interview.getActiveSession(ctx.userId);
          const menu = renderMenu(lang, plan, active !== null);
          return {
            parts: [`${escapeHtml(interviewText(lang, 'planBuilt'))}\n\n${menu.text}`],
            keyboard: menu.keyboard,
          };
        });
        return { ...thinking, editKeyboard: null };

      case 'plan':
      case 'pickTopic': {
        const plan = await this.interview.getActivePlan(ctx.userId);
        if (!plan) return this.noPlan(ctx);
        return this.edit(
          action.kind === 'plan'
            ? renderPlan(lang, plan, action.page)
            : renderTopicPicker(lang, plan, action.page),
        );
      }

      case 'topic': {
        const plan = await this.interview.getActivePlan(ctx.userId);
        if (!plan) return this.noPlan(ctx);
        const screen = renderTopic(lang, plan, action.index);
        if (!screen) {
          return {
            alert: interviewText(lang, 'topicGone'),
            ...this.edit(renderPlan(lang, plan, 0)),
          };
        }
        return this.edit(screen);
      }

      case 'status': {
        const plan = await this.interview.getActivePlan(ctx.userId);
        if (!plan) return this.noPlan(ctx);
        const topic = flattenTopics(plan)[action.index];
        if (!topic) {
          return {
            alert: interviewText(lang, 'topicGone'),
            ...this.edit(renderPlan(lang, plan, 0)),
          };
        }
        const saved = await this.interview.updateProgress(ctx.userId, plan.id, {
          topicKey: topic.key,
          status: action.status,
        });
        const updated = {
          ...plan,
          progress: [...plan.progress.filter((p) => p.topicKey !== topic.key), saved],
        };
        const screen = renderTopic(lang, updated, action.index);
        return {
          alert: interviewText(lang, 'statusSet', { status: statusLabel(lang, action.status) }),
          ...(screen ? this.edit(screen) : {}),
        };
      }

      case 'question':
        return this.showQuestion(ctx, action.index, action.n);

      case 'modelAnswer':
        this.think(ctx, async () => {
          const { modelAnswer } = await this.interview.revealModelAnswer(
            ctx.userId,
            action.questionId,
          );
          return { parts: renderModelAnswer(lang, modelAnswer) };
        });
        return thinking;

      case 'answer':
        await this.dialogs.open(ctx.chatId, {
          userId: ctx.userId,
          flow: DIALOG_FLOW,
          step: DIALOG_STEPS.answer,
          payload: { questionId: action.questionId, index: action.index, n: action.n },
        });
        await this.bot.sendToUser(ctx.userId, renderAnswerPrompt(lang), { parseMode: 'HTML' });
        return {};

      case 'mock':
        return this.startOrResume(ctx);

      case 'finish':
        this.think(
          ctx,
          async () => {
            const session = await this.interview.finishSession(ctx.userId, action.sessionId);
            await this.dialogs.close(ctx.chatId);
            if (!session.feedback) {
              return {
                parts: [escapeHtml(interviewText(lang, 'ended'))],
                keyboard: menuKeyboard(lang),
              };
            }
            return { parts: renderFeedback(lang, session.feedback), keyboard: menuKeyboard(lang) };
          },
          // Not finished (no answer yet, or the model failed): the buttons come back.
          (key) => (key === 'ended' ? menuKeyboard(lang) : mockKeyboard(lang, action.sessionId)),
        );
        return { ...thinking, editKeyboard: null };

      case 'pause':
        await this.dialogs.close(ctx.chatId);
        await this.bot.sendToUser(ctx.userId, escapeHtml(interviewText(lang, 'paused')), {
          parseMode: 'HTML',
          keyboard: pausedKeyboard(lang),
        });
        return { editKeyboard: null };
    }
  }

  /** Question n of a topic, edited into the pressed message; generated when there is none yet. */
  private async showQuestion(
    ctx: BotCallbackContext,
    index: number,
    n: number,
  ): Promise<BotCallbackResult> {
    const lang = ctx.language;
    const plan = await this.interview.getActivePlan(ctx.userId);
    if (!plan) return this.noPlan(ctx);
    const topic = flattenTopics(plan)[index];
    if (!topic) {
      return {
        alert: interviewText(lang, 'topicGone'),
        ...this.edit(renderTopicPicker(lang, plan, 0)),
      };
    }

    const filter = { topic: topic.title, planId: plan.id };
    const existing = orderQuestions(await this.interview.listQuestions(ctx.userId, filter));
    const question = existing[n];
    if (question) return this.edit(renderQuestion(lang, topic.title, index, n, question));

    const target = { ...ctx, editMessageId: ctx.messageId };
    this.think(
      target,
      async () => {
        await this.interview.generateQuestions(ctx.userId, {
          ...filter,
          kind: 'theory',
          count: QUESTIONS_PER_BATCH,
        });
        const all = orderQuestions(await this.interview.listQuestions(ctx.userId, filter));
        // The list holds the 50 newest; past that, n can run off its end.
        const at = Math.min(n, all.length - 1);
        const fresh = all[at];
        if (!fresh) throw new Error('generated questions are missing from the list');
        const screen = renderQuestion(lang, topic.title, index, at, fresh);
        return { parts: [screen.text], keyboard: screen.keyboard };
      },
      () => renderTopicPicker(lang, plan, 0).keyboard,
    );
    return { alert: interviewText(lang, 'thinking') };
  }

  /** Resumes the active mock interview, or starts one (an LLM call for the opening). */
  private async startOrResume(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    const lang = ctx.language;
    const active = await this.interview.getActiveSession(ctx.userId);
    if (active) {
      await this.openMockDialog(ctx, active.id);
      const last = [...active.transcript].reverse().find((t) => t.role === 'interviewer');
      await this.deliver(ctx, null, {
        parts: renderInterviewer(lang, last?.content ?? ''),
        keyboard: mockKeyboard(lang, active.id),
      });
      return {};
    }

    this.think(ctx, async () => {
      const plan = await this.interview.getActivePlan(ctx.userId);
      const session = await this.interview.startSession(
        ctx.userId,
        plan ? { planId: plan.id } : {},
      );
      await this.openMockDialog(ctx, session.id);
      const opening = session.transcript.find((t) => t.role === 'interviewer');
      return {
        parts: renderInterviewer(lang, opening?.content ?? ''),
        keyboard: mockKeyboard(lang, session.id),
      };
    });
    return { alert: interviewText(lang, 'thinking') };
  }

  private async onTyped(ctx: BotMessageContext, text: string, dialog: OpenDialog): Promise<void> {
    if (!isOwnerRole(ctx.role)) {
      await this.dialogs.close(ctx.chatId);
      await this.bot.sendToUser(ctx.userId, escapeHtml(interviewText(ctx.language, 'ownerOnly')));
      return;
    }
    const lang = ctx.language;
    const payload = dialog.payload;

    if (dialog.step === DIALOG_STEPS.answer && typeof payload.questionId === 'string') {
      const questionId = payload.questionId;
      const index = Number(payload.index) || 0;
      const n = Number(payload.n) || 0;
      await this.dialogs.close(ctx.chatId);
      this.think(
        ctx,
        async () => {
          const review = await this.interview.reviewAnswer(
            ctx.userId,
            questionId,
            text.trim().slice(0, MAX_ANSWER),
          );
          return { parts: renderReview(lang, review), keyboard: reviewKeyboard(lang, index, n) };
        },
        () => reviewKeyboard(lang, index, n),
      );
      return;
    }

    if (dialog.step === DIALOG_STEPS.mock && typeof payload.sessionId === 'string') {
      const sessionId = payload.sessionId;
      // Every reply restarts the dialog's clock: a long interview outlives one TTL.
      await this.openMockDialog(ctx, sessionId);
      this.think(
        ctx,
        async () => {
          const session = await this.interview.reply(
            ctx.userId,
            sessionId,
            text.trim().slice(0, MAX_REPLY),
          );
          const last = session.transcript[session.transcript.length - 1];
          return {
            parts: renderInterviewer(lang, last?.role === 'interviewer' ? last.content : ''),
            keyboard: mockKeyboard(lang, sessionId),
          };
        },
        (key) => {
          if (key !== 'ended' && key !== 'noResume') return mockKeyboard(lang, sessionId);
          void this.dialogs.close(ctx.chatId);
          return menuKeyboard(lang);
        },
      );
      return;
    }

    await this.dialogs.close(ctx.chatId);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async menuScreen(userId: string, lang: Language): Promise<Screen> {
    const [plan, session] = await Promise.all([
      this.interview.getActivePlan(userId),
      this.interview.getActiveSession(userId),
    ]);
    return renderMenu(lang, plan, session !== null);
  }

  private async noPlan(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    return {
      alert: interviewText(ctx.language, 'needPlan'),
      ...this.edit(await this.menuScreen(ctx.userId, ctx.language)),
    };
  }

  private async openMockDialog(ctx: { userId: string; chatId: string }, sessionId: string) {
    await this.dialogs.open(ctx.chatId, {
      userId: ctx.userId,
      flow: DIALOG_FLOW,
      step: DIALOG_STEPS.mock,
      payload: { sessionId },
    });
  }

  private edit(screen: Screen): BotCallbackResult {
    return { editText: screen.text, editKeyboard: screen.keyboard };
  }

  /**
   * Shows "⏳ Thinking…" (a new message, or the pressed one rewritten), runs the
   * LLM step in the background and puts its result in the placeholder. A
   * failure becomes a friendly message with `onError`'s buttons (the menu by
   * default); it is logged, never thrown at the webhook.
   */
  private think(
    target: Target,
    work: () => Promise<Delivery>,
    onError: (key: InterviewTextKey) => InlineKeyboard = () => menuKeyboard(target.language),
  ): void {
    const lang = target.language;
    const placeholderText = escapeHtml(interviewText(lang, 'thinking'));
    const task: Promise<void> = (async () => {
      let placeholder: number | null = null;
      if (target.editMessageId !== undefined) {
        placeholder = target.editMessageId;
        await this.bot.editMessage(target.chatId, placeholder, placeholderText, {
          parseMode: 'HTML',
        });
      } else {
        const sent = await this.bot.sendToUser(target.userId, placeholderText, {
          parseMode: 'HTML',
        });
        placeholder = sent === null ? null : Number(sent);
      }

      let delivery: Delivery;
      try {
        delivery = await work();
      } catch (err) {
        const key = errorKey(err);
        this.logger.warn(
          `interview step failed for user ${target.userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        delivery = { parts: [escapeHtml(interviewText(lang, key))], keyboard: onError(key) };
      }
      await this.deliver(target, placeholder, delivery);
    })()
      .catch((err: unknown) => {
        this.logger.error(
          `interview delivery failed for user ${target.userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      })
      .finally(() => {
        this.tasks.delete(task);
      });
    this.tasks.add(task);
  }

  /** Sends the parts in order, the first into the placeholder when there is one. */
  private async deliver(
    target: { userId: string; chatId: string },
    placeholder: number | null,
    { parts, keyboard }: Delivery,
  ): Promise<void> {
    for (const [i, part] of parts.entries()) {
      const options = {
        parseMode: 'HTML' as const,
        disablePreview: true,
        keyboard: i === parts.length - 1 ? keyboard : undefined,
      };
      if (i === 0 && placeholder !== null) {
        await this.bot.editMessage(target.chatId, placeholder, part, options);
      } else {
        await this.bot.sendToUser(target.userId, part, options);
      }
    }
  }
}
