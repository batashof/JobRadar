import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { BOT_CALLBACK_NAMESPACES, reminderThresholdDays } from '@jobradar/shared';
import { eq } from 'drizzle-orm';

import {
  type BotCallbackContext,
  type BotCallbackResult,
  type BotMessageContext,
  BotService,
  defaultTimezone,
} from '../bot/bot.service';
import { DB, type Database } from '../db/db.module';
import { plannerSettings } from '../db/schema';
import {
  applicationsText,
  daysWord,
  isArchived,
  LIST_LIMIT,
  parseCallback,
  type RenderContext,
  renderCard,
  renderDeleteConfirm,
  renderList,
  renderSnoozed,
  type Screen,
  stageLabel,
} from './applications-bot-logic';
import { ApplicationsService } from './applications.service';

/**
 * `/applications` in the bot (roadmap 5.5), for every user: the list of
 * applications, a card per application whose buttons move it through the
 * stages, and the buttons of the follow-up reminders. One message, edited in
 * place as the user taps through it, like `/settings`.
 *
 * Applications are plain board rows (`applications`), the same ones the web
 * board used, so all writes go through `ApplicationsService`.
 */
@Injectable()
export class ApplicationsBotService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
    private readonly applications: ApplicationsService,
  ) {}

  onModuleInit(): void {
    this.bot.registerCommand('applications', (ctx) => this.showList(ctx));
    this.bot.registerCallback(BOT_CALLBACK_NAMESPACES.applications, (ctx) => this.onCallback(ctx));
  }

  private async showList(ctx: BotMessageContext): Promise<void> {
    const screen = await this.listScreen(ctx.userId, await this.renderContext(ctx), false);
    await this.bot.sendToUser(ctx.userId, screen.text, {
      parseMode: 'HTML',
      disablePreview: true,
      keyboard: screen.keyboard,
    });
  }

  private async onCallback(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    const action = parseCallback(ctx.parts);
    if (!action) return {};
    const render = await this.renderContext(ctx);

    if (action.kind === 'list') {
      return this.edit(await this.listScreen(ctx.userId, render, action.archived));
    }

    const item = await this.applications.get(ctx.userId, action.id);
    if (!item) {
      // Deleted from another message, or a reminder outlived its application.
      return {
        alert: applicationsText(ctx.language, 'gone'),
        ...this.edit(await this.listScreen(ctx.userId, render, false)),
      };
    }

    switch (action.kind) {
      case 'open':
        return this.edit(renderCard(render, item));
      case 'stage': {
        const updated = await this.applications.update(ctx.userId, item.id, {
          stage: action.stage,
        });
        return {
          alert: applicationsText(ctx.language, 'moved', {
            stage: stageLabel(ctx.language, action.stage),
          }),
          ...this.edit(renderCard(render, updated)),
        };
      }
      case 'askDelete':
        return this.edit(renderDeleteConfirm(render, item));
      case 'delete':
        await this.applications.remove(ctx.userId, item.id);
        return {
          alert: applicationsText(ctx.language, 'deleted'),
          ...this.edit(await this.listScreen(ctx.userId, render, isArchived(item.stage))),
        };
      case 'snooze': {
        const snoozed = await this.applications.snooze(ctx.userId, item.id);
        const days = reminderThresholdDays(snoozed);
        const screen = renderSnoozed(ctx.language, snoozed, days);
        return {
          alert: applicationsText(ctx.language, 'snoozed', {
            days: daysWord(ctx.language, days),
          }),
          editText: screen.text,
          editKeyboard: null,
        };
      }
    }
  }

  private async listScreen(
    userId: string,
    render: RenderContext,
    archived: boolean,
  ): Promise<Screen> {
    const [items, stats] = await Promise.all([
      this.applications.listRecent(userId, archived, LIST_LIMIT),
      this.applications.stats(userId),
    ]);
    return renderList(render, archived, items, stats.byStage);
  }

  private edit(screen: Screen): BotCallbackResult {
    return { editText: screen.text, editKeyboard: screen.keyboard };
  }

  private async renderContext(ctx: BotMessageContext): Promise<RenderContext> {
    const [row] = await this.db
      .select({ timezone: plannerSettings.timezone })
      .from(plannerSettings)
      .where(eq(plannerSettings.userId, ctx.userId));
    return {
      lang: ctx.language,
      now: new Date(),
      timezone: row?.timezone ?? defaultTimezone(ctx.language),
    };
  }
}
