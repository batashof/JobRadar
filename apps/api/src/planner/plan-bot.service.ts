import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { isOwnerRole, type Language, type PlannerTodayResponse } from '@jobradar/shared';

import { BotDialogs, type OpenDialog } from '../bot/bot-dialogs';
import {
  type BotCallbackContext,
  type BotCallbackResult,
  type BotMessageContext,
  BotService,
} from '../bot/bot.service';
import {
  composeNotice,
  NS,
  parseBlockInput,
  parseCallback,
  PLAN_DIALOG_FLOW,
  type PlanAction,
  planText,
  type PlanTextKey,
  type PlanView,
  renderAddPrompt,
  renderBlock,
  renderCloseConfirm,
  renderComposeFailed,
  renderPlan,
  renderThinking,
  type Screen,
  visibleBlocks,
} from './plan-bot-logic';
import { PlannerService } from './planner.service';

/**
 * `/plan` in the bot (roadmap 5.5): the day planner's composition and
 * close-out moved from the website into the chat. Owner only (ADR-024 §3):
 * composing calls the LLM per action, which non-owners never get.
 *
 * One message, edited in place as the owner taps through it, like
 * `/applications`. Every write goes through `PlannerService`, so the bot
 * enforces exactly the rules the web planner did (ADR-015).
 */
@Injectable()
export class PlanBotService implements OnModuleInit {
  private readonly logger = new Logger(PlanBotService.name);

  constructor(
    private readonly bot: BotService,
    private readonly dialogs: BotDialogs,
    private readonly planner: PlannerService,
  ) {}

  onModuleInit(): void {
    this.bot.registerCommand('plan', (ctx) => this.showPlan(ctx));
    this.bot.registerCallback(NS, (ctx) => this.onCallback(ctx));
    this.bot.registerDialog(PLAN_DIALOG_FLOW, (ctx, text, dialog) =>
      this.onTyped(ctx, text, dialog),
    );
  }

  private async showPlan(ctx: BotMessageContext): Promise<void> {
    if (!isOwnerRole(ctx.role)) {
      await this.bot.sendToUser(ctx.userId, planText(ctx.language, 'ownerOnly'));
      return;
    }
    await this.dialogs.close(ctx.chatId);
    await this.send(ctx.userId, renderPlan(await this.view(ctx.userId, ctx.language)));
  }

  private async onCallback(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    if (!isOwnerRole(ctx.role)) return { alert: planText(ctx.language, 'ownerOnly') };
    const action = parseCallback(ctx.parts);
    if (!action) return {};

    // Any button but "add a block" abandons a half-typed block.
    if (action.kind === 'add') {
      const today = await this.planner.getToday(ctx.userId);
      await this.dialogs.open(ctx.chatId, {
        userId: ctx.userId,
        flow: PLAN_DIALOG_FLOW,
        step: 'add',
        payload: {},
      });
      return this.edit(renderAddPrompt(ctx.language, today.settings.defaultBlockMinutes));
    }
    await this.dialogs.close(ctx.chatId);

    try {
      return await this.act(ctx, action);
    } catch (err) {
      // A stale button (the block finished elsewhere, the day closed): show
      // the plan as it is now rather than a bare error.
      this.logger.warn(
        `plan action ${ctx.parts.join(':')} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        alert: planText(ctx.language, 'failed'),
        ...this.edit(renderPlan(await this.view(ctx.userId, ctx.language))),
      };
    }
  }

  private async act(
    ctx: BotCallbackContext,
    action: Exclude<PlanAction, { kind: 'add' }>,
  ): Promise<BotCallbackResult> {
    const { userId, language: lang } = ctx;
    switch (action.kind) {
      case 'view':
        return this.edit(renderPlan(await this.view(userId, lang)));
      case 'send':
        // From a nudge: a fresh plan message, the nudge keeps its own buttons.
        await this.send(userId, renderPlan(await this.view(userId, lang)));
        return {};
      case 'compose':
        return this.compose(ctx, action.regenerate);
      case 'accept': {
        const today = await this.planner.getToday(userId);
        if (!today.plan) return this.edit(renderPlan(this.toView(today, lang)));
        await this.planner.acceptPlan(userId, today.plan.id);
        return this.alertAndPlan(ctx, 'accepted_alert');
      }
      case 'askClose':
        return this.edit(renderCloseConfirm(lang));
      case 'close': {
        const today = await this.planner.getToday(userId);
        if (!today.plan) return this.edit(renderPlan(this.toView(today, lang)));
        await this.planner.closePlan(userId, today.plan.id, {});
        // The closed plan carries the day's result: done vs planned, debt.
        return this.edit(renderPlan(await this.view(userId, lang)));
      }
      default:
        return this.blockAction(ctx, action);
    }
  }

  private async blockAction(
    ctx: BotCallbackContext,
    action: Extract<PlanAction, { id: string }>,
  ): Promise<BotCallbackResult> {
    const { userId, language: lang } = ctx;
    const today = await this.planner.getToday(userId);
    const block = visibleBlocks(today.plan).find((item) => item.id === action.id);
    if (!block) {
      return {
        alert: planText(lang, 'gone'),
        ...this.edit(renderPlan(this.toView(today, lang))),
      };
    }

    switch (action.kind) {
      case 'open':
        return this.edit(renderBlock(this.toView(today, lang), block));
      case 'start':
        await this.planner.startBlock(userId, block.id);
        return this.alertAndBlock(ctx, block.id, 'started');
      case 'pause':
        await this.planner.pauseBlock(userId, block.id);
        return this.alertAndBlock(ctx, block.id, 'paused');
      case 'done':
        await this.planner.completeBlock(userId, block.id, { status: 'done' });
        return this.alertAndPlan(ctx, 'done');
      case 'drop':
        // Dropping is recorded with a reason (ADR-015 §4); a deliberate tap
        // from the plan is a change of priority, not avoidance.
        await this.planner.dropBlock(userId, block.id, { reason: 'changed_priority' });
        return this.alertAndPlan(ctx, 'dropped');
    }
  }

  /**
   * The LLM call takes seconds, so the message says so first. `generatePlan`
   * already falls back to a fixed ordering when the LLM fails; what lands here
   * is everything else (database, a day closed meanwhile).
   */
  private async compose(ctx: BotCallbackContext, regenerate: boolean): Promise<BotCallbackResult> {
    const { userId, language: lang } = ctx;
    const before = await this.planner.getToday(userId);
    await this.bot.editMessage(ctx.chatId, ctx.messageId, renderThinking(lang), {
      parseMode: 'HTML',
      keyboard: [],
    });
    try {
      const plan = await this.planner.generatePlan(userId, lang, {
        // An existing day with only dropped blocks still counts as "has blocks".
        regenerate: regenerate || (before.plan?.blocks.length ?? 0) > 0,
      });
      const view = { ...this.toView(before, lang), plan };
      return {
        alert: planText(lang, 'composed'),
        ...this.edit(renderPlan(view, composeNotice(lang, plan))),
      };
    } catch (err) {
      this.logger.warn(
        `plan composition failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.edit(renderComposeFailed(lang));
    }
  }

  private async onTyped(ctx: BotMessageContext, text: string, dialog: OpenDialog): Promise<void> {
    if (!isOwnerRole(ctx.role) || dialog.step !== 'add') {
      await this.dialogs.close(ctx.chatId);
      if (!isOwnerRole(ctx.role)) {
        await this.bot.sendToUser(ctx.userId, planText(ctx.language, 'ownerOnly'));
      }
      return;
    }
    const typed = parseBlockInput(text);
    if (!typed) {
      // The dialog stays open: the next message is another try.
      await this.bot.sendToUser(ctx.userId, planText(ctx.language, 'badInput'));
      return;
    }
    try {
      await this.planner.addBlock(ctx.userId, {
        title: typed.title,
        category: 'other',
        ...(typed.minutes !== null ? { estimateMinutes: typed.minutes } : {}),
      });
    } catch (err) {
      await this.dialogs.close(ctx.chatId);
      this.logger.warn(
        `adding a block failed for ${ctx.userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.send(
        ctx.userId,
        renderPlan(await this.view(ctx.userId, ctx.language), planText(ctx.language, 'failed')),
      );
      return;
    }
    await this.dialogs.close(ctx.chatId);
    await this.send(
      ctx.userId,
      renderPlan(
        await this.view(ctx.userId, ctx.language),
        planText(ctx.language, 'added', { title: typed.title }),
      ),
    );
  }

  private async alertAndPlan(
    ctx: BotCallbackContext,
    key: PlanTextKey,
  ): Promise<BotCallbackResult> {
    return {
      alert: planText(ctx.language, key),
      ...this.edit(renderPlan(await this.view(ctx.userId, ctx.language))),
    };
  }

  private async alertAndBlock(
    ctx: BotCallbackContext,
    blockId: string,
    key: PlanTextKey,
  ): Promise<BotCallbackResult> {
    const view = await this.view(ctx.userId, ctx.language);
    const block = visibleBlocks(view.plan).find((item) => item.id === blockId);
    return {
      alert: planText(ctx.language, key),
      ...this.edit(block ? renderBlock(view, block) : renderPlan(view)),
    };
  }

  private async view(userId: string, lang: Language): Promise<PlanView> {
    return this.toView(await this.planner.getToday(userId), lang);
  }

  private toView(today: PlannerTodayResponse, lang: Language): PlanView {
    return {
      lang,
      now: new Date(),
      today: today.today,
      plan: today.plan,
      capacityMinutes: today.settings.capacityMinutes,
    };
  }

  private edit(screen: Screen): BotCallbackResult {
    return { editText: screen.text, editKeyboard: screen.keyboard };
  }

  private async send(userId: string, screen: Screen): Promise<void> {
    await this.bot.sendToUser(userId, screen.text, {
      parseMode: 'HTML',
      disablePreview: true,
      keyboard: screen.keyboard,
    });
  }
}
