import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  BOT_CALLBACK_NAMESPACES,
  DIGEST_DEFAULTS,
  type DigestMode,
  isOwnerRole,
  type Language,
} from '@jobradar/shared';
import { asc, eq } from 'drizzle-orm';

import { BotDialogs, type OpenDialog } from '../bot/bot-dialogs';
import {
  type BotCallbackContext,
  type BotCallbackResult,
  type BotMessageContext,
  BotService,
  defaultTimezone,
} from '../bot/bot.service';
import { recordEvent } from '../common/events';
import { DB, type Database } from '../db/db.module';
import { digestSettings, plannerSettings, sources, users } from '../db/schema';
import {
  decide,
  parseTyped,
  renderScreen,
  type SettingsPatch,
  type SettingsState,
  settingsText,
  TYPE_STEPS,
  type TypeStep,
} from './settings-logic';

const FLOW = 'settings';

/** The LinkedIn alerts source (ADR-021, ADR-027). */
const LINKEDIN_SLUG = 'linkedin';

/**
 * `/settings` in the chat (roadmap 5.3): every delivery setting the website had,
 * as one message whose buttons edit it in place, plus typed answers for the
 * values that do not fit on a button (times, quiet hours, timezone, salary).
 *
 * Settings live where they always did: `digest_settings` for delivery and the
 * hard filters, `planner_settings.timezone` for the one timezone per user
 * (ADR-015 §7), `users.language` for the language (ADR-014).
 */
@Injectable()
export class SettingsBotService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
    private readonly dialogs: BotDialogs,
  ) {}

  onModuleInit(): void {
    this.bot.registerCommand('settings', (ctx) => this.showMenu(ctx));
    this.bot.registerCallback(BOT_CALLBACK_NAMESPACES.settings, (ctx) => this.onCallback(ctx));
    this.bot.registerDialog(FLOW, (ctx, text, dialog) => this.onTyped(ctx, text, dialog));
  }

  private async showMenu(ctx: BotMessageContext): Promise<void> {
    await this.dialogs.close(ctx.chatId);
    const state = await this.load(ctx.userId, ctx.language);
    const screen = renderScreen('main', state, await this.sourceSlugs(ctx));
    await this.bot.sendToUser(ctx.userId, screen.text, {
      parseMode: 'HTML',
      keyboard: screen.keyboard,
    });
  }

  private async onCallback(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    const state = await this.load(ctx.userId, ctx.language);
    const slugs = await this.sourceSlugs(ctx);
    const decision = decide(state, ctx.parts, slugs);

    let next = state;
    if (decision.patch) {
      next = { ...state, ...decision.patch };
      await this.save(ctx.userId, decision.patch);
    }
    if (decision.typeStep) {
      await this.dialogs.open(ctx.chatId, {
        userId: ctx.userId,
        flow: FLOW,
        step: decision.typeStep,
        payload: {},
      });
    } else {
      // Any button but "type it" abandons a half-typed answer.
      await this.dialogs.close(ctx.chatId);
    }

    const screen = renderScreen(decision.screen, next, slugs, decision.typeStep);
    return { editText: screen.text, editKeyboard: screen.keyboard };
  }

  private async onTyped(ctx: BotMessageContext, text: string, dialog: OpenDialog): Promise<void> {
    const step = (TYPE_STEPS as readonly string[]).includes(dialog.step)
      ? (dialog.step as TypeStep)
      : null;
    const patch = step ? parseTyped(step, text) : null;
    if (!patch) {
      // The dialog stays open: the next message is another try.
      await this.bot.sendToUser(ctx.userId, settingsText(ctx.language, 'badInput'));
      return;
    }
    await this.save(ctx.userId, patch);
    await this.dialogs.close(ctx.chatId);
    const state = await this.load(ctx.userId, ctx.language);
    const screen = renderScreen('main', state, await this.sourceSlugs(ctx));
    await this.bot.sendToUser(ctx.userId, `${settingsText(state.language, 'saved')}\n\n${screen.text}`, {
      parseMode: 'HTML',
      keyboard: screen.keyboard,
    });
  }

  /** The current settings; defaults where a row is missing (an account older than 5.3). */
  async load(userId: string, language: Language): Promise<SettingsState> {
    const [digest] = await this.db
      .select()
      .from(digestSettings)
      .where(eq(digestSettings.userId, userId));
    const [planner] = await this.db
      .select({ timezone: plannerSettings.timezone })
      .from(plannerSettings)
      .where(eq(plannerSettings.userId, userId));

    return {
      enabled: digest?.enabled ?? DIGEST_DEFAULTS.enabled,
      mode: (digest?.mode as DigestMode | undefined) ?? DIGEST_DEFAULTS.mode,
      sendTimes: digest?.sendTimes ?? [...DIGEST_DEFAULTS.sendTimes],
      quietStart: digest?.quietStart ?? DIGEST_DEFAULTS.quietStart,
      quietEnd: digest?.quietEnd ?? DIGEST_DEFAULTS.quietEnd,
      minScore: digest?.minScore ?? DIGEST_DEFAULTS.minScore,
      instantMinScore: digest?.instantMinScore ?? DIGEST_DEFAULTS.instantMinScore,
      maxItems: digest ? digest.maxItems : DIGEST_DEFAULTS.maxItems,
      workFormats: digest?.workFormats ?? [],
      employmentTypes: digest?.employmentTypes ?? [],
      minSalaryUsd: digest?.minSalaryUsd ?? null,
      mutedSources: digest?.mutedSources ?? [],
      timezone: planner?.timezone ?? defaultTimezone(language),
      language,
    };
  }

  /** Writes a patch to the table each field lives in. */
  async save(userId: string, patch: SettingsPatch): Promise<void> {
    const now = new Date();
    const { language, timezone, ...digest } = patch;

    if (Object.keys(digest).length > 0) {
      await this.db
        .insert(digestSettings)
        .values({ userId, ...digest })
        .onConflictDoUpdate({ target: digestSettings.userId, set: { ...digest, updatedAt: now } });
    }
    if (timezone) {
      await this.db
        .insert(plannerSettings)
        .values({ userId, timezone })
        .onConflictDoUpdate({ target: plannerSettings.userId, set: { timezone, updatedAt: now } });
    }
    if (language) {
      await this.db.update(users).set({ language, updatedAt: now }).where(eq(users.id, userId));
    }
    await recordEvent(this.db, userId, 'settings_changed', { keys: Object.keys(patch).join(',') });
  }

  /**
   * Sources a user can switch off: the active ones they receive at all. An
   * owner-only source is the owner's, except LinkedIn for a user who has a
   * personal forwarding address (ADR-027): their own alerts come through it.
   */
  private async sourceSlugs(ctx: { userId: string; role: string }): Promise<string[]> {
    const rows = await this.db
      .select({ slug: sources.slug, config: sources.config })
      .from(sources)
      .where(eq(sources.isActive, true))
      .orderBy(asc(sources.slug));
    if (isOwnerRole(ctx.role)) return rows.map((row) => row.slug);

    const ownerOnly = (row: (typeof rows)[number]) =>
      !!(row.config as { ownerOnly?: boolean } | null)?.ownerOnly;
    const forwardsLinkedIn =
      rows.some((row) => row.slug === LINKEDIN_SLUG && ownerOnly(row)) &&
      (await this.hasAlertsToken(ctx.userId));
    return rows
      .filter((row) => !ownerOnly(row) || (row.slug === LINKEDIN_SLUG && forwardsLinkedIn))
      .map((row) => row.slug);
  }

  private async hasAlertsToken(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ token: users.alertsToken })
      .from(users)
      .where(eq(users.id, userId));
    return !!row?.token;
  }
}
