import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { BOT_CALLBACK_NAMESPACES, isOwnerRole } from '@jobradar/shared';

import {
  type BotCallbackContext,
  type BotCallbackResult,
  type BotMessageContext,
  BotService,
} from '../bot/bot.service';
import { DB, type Database } from '../db/db.module';
import { loadTriage, markDigested, setReportStatus } from './reports';
import { renderTriage, triageText } from './triage-logic';

const ACTIONS = { f: 'fix', s: 'skip', n: 'new' } as const;
const TOASTS = { fix: 'marked', skip: 'skipped', new: 'reopened' } as const;

/**
 * The owner's side of the bug and feedback inbox (ADR-037): `/triage` shows
 * the open list, and its buttons (also on the daily digest the workflow
 * sends) mark an item to fix, skip it or take the mark back. The daily
 * `Triage` workflow turns marked items into GitHub issues for the fixer.
 */
@Injectable()
export class TriageBotService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
  ) {}

  onModuleInit(): void {
    this.bot.registerCommand('triage', (ctx) => this.show(ctx));
    this.bot.registerCallback(BOT_CALLBACK_NAMESPACES.triage, (ctx) => this.press(ctx));
  }

  async show(ctx: BotMessageContext): Promise<void> {
    if (!isOwnerRole(ctx.role)) {
      await this.bot.sendToUser(ctx.userId, triageText(ctx.language, 'ownerOnly'));
      return;
    }
    const { items, extras } = await loadTriage(this.db);
    const { text, keyboard } = renderTriage(ctx.language, items, extras);
    const sent = await this.bot.sendToUser(ctx.userId, text, {
      parseMode: 'HTML',
      disablePreview: true,
      keyboard,
    });
    // Seen here counts as seen: the morning digest need not repeat it.
    if (sent) await markDigested(this.db, items.map((item) => item.id));
  }

  async press(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    if (!isOwnerRole(ctx.role)) return { alert: triageText(ctx.language, 'ownerOnly') };
    const status = ACTIONS[ctx.parts[1] as keyof typeof ACTIONS];
    const id = Number(ctx.parts[2]);
    if (!status || !Number.isInteger(id)) return {};

    const changed = await setReportStatus(this.db, id, status);
    const { items, extras } = await loadTriage(this.db);
    const { text, keyboard } = renderTriage(ctx.language, items, extras);
    return {
      alert: triageText(ctx.language, changed ? TOASTS[status] : 'gone', { id }),
      editText: text,
      editKeyboard: keyboard,
    };
  }
}
