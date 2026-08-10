import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BOT_CALLBACK_NAMESPACES,
  type Language,
  type PlannerNudgeKind,
} from '@jobradar/shared';
import { and, eq } from 'drizzle-orm';

import {
  type BotCallbackContext,
  type BotCallbackResult,
  BotService,
} from '../bot/bot.service';
import { escapeHtml, type InlineKeyboard } from '../bot/telegram-api';
import { DB, type Database } from '../db/db.module';
import { planBlocks, plannerNudges, users } from '../db/schema';
import { PlannerService } from './planner.service';

const NS = BOT_CALLBACK_NAMESPACES.nudge;

/** Callback actions, one letter each — `callback_data` is capped at 64 bytes. */
const ACTION = {
  ack: 'a',
  start: 's',
  done: 'd',
  skip: 'k',
} as const;

const TEXT = {
  en: {
    morning: 'The day is not taken on yet — compose it and commit.',
    block_start: 'Nothing is running. Start the next block.',
    midway: 'This block is running well past its estimate. Finish it or park it.',
    evening: 'Time for the review — close the day.',
    escalation: 'Still waiting on you.',
    debt: 'You have debt from earlier days. It goes first.',
    'btn.open': 'Open',
    'btn.ack': 'Got it',
    'btn.start': 'Start',
    'btn.done': 'Done',
    'btn.skip': 'Skip',
    'done.ack': 'Noted',
    'done.start': 'Started',
    'done.done': 'Done',
    'done.skip': 'Skipped',
    'resolved.ack': 'Noted.',
    'resolved.start': 'Started — the clock is running.',
    'resolved.done': 'Done.',
    'resolved.skip': 'Skipped — it carries over as debt.',
    'repeat': 'Reminder {count}',
    'unit.min': 'min',
  },
  ru: {
    morning: 'День ещё не принят — собери его и возьми на себя.',
    block_start: 'Ничего не идёт. Начни следующий блок.',
    midway: 'Блок сильно вышел за оценку. Заверши его или отложи.',
    evening: 'Время разбора — закрой день.',
    escalation: 'Всё ещё ждём тебя.',
    debt: 'Есть долг с прошлых дней. Он идёт первым.',
    'btn.open': 'Открыть',
    'btn.ack': 'Понял',
    'btn.start': 'Начать',
    'btn.done': 'Готово',
    'btn.skip': 'Пропустить',
    'done.ack': 'Принято',
    'done.start': 'Запущено',
    'done.done': 'Готово',
    'done.skip': 'Пропущено',
    'resolved.ack': 'Принято.',
    'resolved.start': 'Запущено — время идёт.',
    'resolved.done': 'Готово.',
    'resolved.skip': 'Пропущено — переносится в долг.',
    'repeat': 'Напоминание {count}',
    'unit.min': 'мин',
  },
} as const;

type TextKey = keyof (typeof TEXT)['en'];

function t(lang: Language, key: TextKey): string {
  return TEXT[lang]?.[key] ?? TEXT.en[key];
}

/** Nudges that point at one block get block actions instead of a bare ack. */
const BLOCK_SCOPED: readonly PlannerNudgeKind[] = ['block_start', 'midway'];

interface NudgeRow {
  id: string;
  userId: string;
  kind: PlannerNudgeKind;
  blockId: string | null;
  repeatIndex: number;
}

/**
 * Telegram delivery for planner nudges (ADR-015 §6) — the channel the ADR
 * always specified, plugged into the `planner_nudges` rows the tick already
 * writes. In-app delivery is unchanged and remains the fallback: a nudge is
 * recorded whether or not the bot is configured or the user is linked.
 *
 * The buttons resolve a block without opening the app, which is the whole
 * point of the channel; every action goes through `PlannerService`, so the
 * bot path enforces exactly the same rules as the web one.
 */
@Injectable()
export class PlannerBotService implements OnModuleInit {
  private readonly logger = new Logger(PlannerBotService.name);
  private readonly webOrigin: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
    private readonly planner: PlannerService,
    config: ConfigService,
  ) {
    this.webOrigin = (config.get<string>('WEB_ORIGIN') ?? '').replace(/\/$/, '');
  }

  onModuleInit(): void {
    this.bot.registerCallback(NS, (ctx) => this.handleCallback(ctx));
  }

  /**
   * Sends a nudge to the user's chat. Returns the Telegram message id, or null
   * when the bot is off, the user is unlinked, or Telegram refused — the tick
   * treats all three the same way: the row stays, in-app delivery still works.
   */
  async deliver(nudge: NudgeRow, enabled: boolean): Promise<string | null> {
    if (!enabled || !this.bot.isConfigured()) return null;

    const language = await this.languageOf(nudge.userId);
    const text = await this.render(nudge, language);
    const keyboard = this.keyboard(nudge, language);

    return this.bot.sendToUser(nudge.userId, text, {
      parseMode: 'HTML',
      disablePreview: true,
      keyboard,
    });
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private async render(nudge: NudgeRow, language: Language): Promise<string> {
    const lines = [`<b>${escapeHtml(t(language, nudge.kind))}</b>`];

    if (nudge.blockId) {
      const [block] = await this.db
        .select({
          title: planBlocks.title,
          estimate: planBlocks.correctedEstimateMinutes,
          actual: planBlocks.actualMinutes,
        })
        .from(planBlocks)
        .where(eq(planBlocks.id, nudge.blockId));
      if (block) {
        const unit = t(language, 'unit.min');
        const timing =
          nudge.kind === 'midway'
            ? `${block.actual} / ${block.estimate} ${unit}`
            : `${block.estimate} ${unit}`;
        lines.push('', `${escapeHtml(block.title)} — ${escapeHtml(timing)}`);
      }
    }

    if (nudge.repeatIndex > 0) {
      lines.push('', `<i>${escapeHtml(t(language, 'repeat').replace('{count}', String(nudge.repeatIndex + 1)))}</i>`);
    }
    return lines.join('\n');
  }

  private keyboard(nudge: NudgeRow, language: Language): InlineKeyboard {
    const open = this.webOrigin
      ? [{ text: t(language, 'btn.open'), url: `${this.webOrigin}/app/day` }]
      : [];

    if (nudge.blockId && BLOCK_SCOPED.includes(nudge.kind)) {
      const actions =
        nudge.kind === 'block_start'
          ? [
              { text: t(language, 'btn.start'), callbackData: `${NS}:${ACTION.start}:${nudge.id}` },
              { text: t(language, 'btn.skip'), callbackData: `${NS}:${ACTION.skip}:${nudge.id}` },
            ]
          : [
              { text: t(language, 'btn.done'), callbackData: `${NS}:${ACTION.done}:${nudge.id}` },
              { text: t(language, 'btn.skip'), callbackData: `${NS}:${ACTION.skip}:${nudge.id}` },
            ];
      return open.length ? [actions, open] : [actions];
    }

    const ack = [{ text: t(language, 'btn.ack'), callbackData: `${NS}:${ACTION.ack}:${nudge.id}` }];
    return open.length ? [[...ack, ...open]] : [ack];
  }

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------

  private async handleCallback(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    const [, action, nudgeId] = ctx.parts;
    if (!action || !nudgeId) {
      return { alert: t(ctx.language, 'resolved.ack') };
    }

    const [nudge] = await this.db
      .select({
        id: plannerNudges.id,
        kind: plannerNudges.kind,
        blockId: plannerNudges.blockId,
        status: plannerNudges.status,
      })
      .from(plannerNudges)
      .where(and(eq(plannerNudges.id, nudgeId), eq(plannerNudges.userId, ctx.userId)));
    if (!nudge) {
      // Acknowledged from the app, or the plan was deleted. Nothing to do.
      return { alert: t(ctx.language, 'resolved.ack'), editKeyboard: null };
    }

    switch (action) {
      case ACTION.start:
        if (nudge.blockId) await this.planner.startBlock(ctx.userId, nudge.blockId);
        break;
      case ACTION.done:
        if (nudge.blockId) {
          await this.planner.completeBlock(ctx.userId, nudge.blockId, { status: 'done' });
        }
        break;
      case ACTION.skip:
        if (nudge.blockId) {
          // A skip from the phone is still a recorded reason (ADR-015 §4) —
          // "no time" is the honest default for a one-tap resolution.
          await this.planner.completeBlock(ctx.userId, nudge.blockId, {
            status: 'skipped',
            reason: 'no_time',
          });
        }
        break;
      default:
        break;
    }

    // Every button also acknowledges the nudge: acting on it *is* the answer.
    if (nudge.status === 'sent') {
      await this.planner.acknowledgeNudge(ctx.userId, nudge.id).catch((err: unknown) => {
        this.logger.warn(
          `ack of nudge ${nudge.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    const resolution = resolutionKey(action);
    return {
      alert: t(ctx.language, `done.${resolution}` as TextKey),
      editText: `<s>${escapeHtml(t(ctx.language, nudge.kind))}</s>\n\n${escapeHtml(
        t(ctx.language, `resolved.${resolution}` as TextKey),
      )}`,
      editKeyboard: null,
    };
  }

  private async languageOf(userId: string): Promise<Language> {
    const [row] = await this.db
      .select({ language: users.language })
      .from(users)
      .where(eq(users.id, userId));
    return row?.language === 'en' ? 'en' : 'ru';
  }
}

function resolutionKey(action: string): 'ack' | 'start' | 'done' | 'skip' {
  switch (action) {
    case ACTION.start:
      return 'start';
    case ACTION.done:
      return 'done';
    case ACTION.skip:
      return 'skip';
    default:
      return 'ack';
  }
}
