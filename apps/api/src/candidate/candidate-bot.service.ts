import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BOT_CALLBACK_NAMESPACES,
  ENGLISH_LEVELS,
  isOwnerRole,
  RESUME_ANALYSES_PER_WINDOW,
  RESUME_ANALYSIS_WINDOW_DAYS,
  RESUME_MAX_BYTES,
  SENIORITY_LEVELS,
} from '@jobradar/shared';

import {
  type BotCallbackContext,
  type BotCallbackResult,
  type BotMessageContext,
  BotService,
} from '../bot/bot.service';
import { BotDialogs } from '../bot/bot-dialogs';
import { escapeHtml } from '../bot/telegram-api';
import { recordEvent } from '../common/events';
import { DB, type Database } from '../db/db.module';
import { LlmService } from '../llm/llm.service';
import { ResumesService } from '../resumes/resumes.service';
import {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisPrompt,
  fallbackProfile,
  parseAnalysis,
  ROLE_TITLES,
} from './analysis';
import { type CandidateProfileRow, CandidateService, type ProfileWrite } from './candidate.service';
import {
  evaluationMessage,
  parseSkillsInput,
  pickerKeyboard,
  profileCard,
  profileText,
  type ProfileTextKey,
  resumeScreen,
  setupScreen,
} from './render';

/** The dialog flow name this service owns in `bot_dialogs`. */
const FLOW = 'profile';

/**
 * Providers a non-owner's resume may reach (ADR-025 §4): only those that do not
 * train on free-tier data. Groq does not; OpenRouter's free models depend on
 * the account's data policy, so it is opt-in through `LLM_RESUME_PROVIDERS`
 * after that setting is checked. Gemini's free tier trains on input: never.
 */
const DEFAULT_RESUME_PROVIDERS = ['groq'];

/**
 * Resume upload and evaluation in the chat (ADR-025, roadmap 5.2): a PDF sent
 * to the bot is stored, read by one LLM call (or the term fallback), shown back
 * as a resume review plus a profile card, and confirmed or corrected with
 * buttons and one typed answer (skills).
 */
@Injectable()
export class CandidateBotService implements OnModuleInit {
  private readonly logger = new Logger(CandidateBotService.name);
  private readonly resumeProviders: string[];

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
    private readonly dialogs: BotDialogs,
    private readonly llm: LlmService,
    private readonly resumes: ResumesService,
    private readonly profiles: CandidateService,
    config: ConfigService,
  ) {
    const configured = config.get<string>('LLM_RESUME_PROVIDERS')?.trim();
    this.resumeProviders = configured
      ? configured
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p && p !== 'gemini')
      : DEFAULT_RESUME_PROVIDERS;
  }

  onModuleInit(): void {
    this.bot.registerDocumentHandler((ctx, doc) => this.onDocument(ctx, doc));
    this.bot.registerDialog(FLOW, (ctx, text) => this.onSkillsText(ctx, text));
    this.bot.registerCallback(BOT_CALLBACK_NAMESPACES.profile, (ctx) => this.onCallback(ctx));
    this.bot.registerCommand('resume', (ctx) => this.showResume(ctx));
    this.bot.registerCommand('setup', (ctx) => this.showSetup(ctx));
  }

  // -------------------------------------------------------------------------
  // /resume and /setup (roadmap 5.9)
  // -------------------------------------------------------------------------

  /** What is uploaded, and how to add or replace it. */
  async showResume(ctx: { userId: string; language: BotMessageContext['language']; role: string }): Promise<void> {
    const [resume, profile] = await Promise.all([
      this.resumes.getActive(ctx.userId),
      this.profiles.get(ctx.userId),
    ]);
    const screen = resumeScreen(ctx.language, resume, {
      hasProfile: profile !== null,
      limit: isOwnerRole(ctx.role)
        ? undefined
        : { n: RESUME_ANALYSES_PER_WINDOW, days: RESUME_ANALYSIS_WINDOW_DAYS },
    });
    await this.bot.sendToUser(ctx.userId, screen.text, { parseMode: 'HTML', keyboard: screen.keyboard });
  }

  /** The step-by-step checklist for a new account. */
  async showSetup(ctx: { userId: string; language: BotMessageContext['language'] }): Promise<void> {
    const [resume, profile] = await Promise.all([
      this.resumes.getActive(ctx.userId),
      this.profiles.get(ctx.userId),
    ]);
    const screen = setupScreen(ctx.language, {
      resume,
      profile: !profile ? 'none' : profile.confirmedAt ? 'confirmed' : 'unconfirmed',
    });
    await this.bot.sendToUser(ctx.userId, screen.text, { parseMode: 'HTML', keyboard: screen.keyboard });
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  async onDocument(
    ctx: BotMessageContext,
    doc: { fileId: string; fileName: string; mimeType: string | null; fileSize: number | null },
  ): Promise<void> {
    const isPdf = doc.mimeType === 'application/pdf' || doc.fileName.toLowerCase().endsWith('.pdf');
    if (!isPdf) return this.say(ctx, 'notPdf');
    if (doc.fileSize !== null && doc.fileSize > RESUME_MAX_BYTES) return this.say(ctx, 'tooBig');
    if (await this.limitReached(ctx)) return this.sayLimit(ctx);

    await this.say(ctx, 'reading');
    // Download + LLM can take longer than Telegram waits for the webhook to
    // answer; acknowledge now and finish in the background.
    void this.ingest(ctx, doc).catch((err) => {
      this.logger.error(
        `resume flow failed for ${ctx.userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      void this.say(ctx, 'downloadFailed');
    });
  }

  private async ingest(
    ctx: BotMessageContext,
    doc: { fileId: string; fileName: string },
  ): Promise<void> {
    let bytes: Buffer;
    try {
      bytes = await this.bot.downloadFile(doc.fileId, RESUME_MAX_BYTES);
    } catch (err) {
      this.logger.warn(`resume download failed: ${err instanceof Error ? err.message : String(err)}`);
      return this.say(ctx, 'downloadFailed');
    }

    let resumeId: string;
    try {
      resumeId = (await this.resumes.upload(ctx.userId, doc.fileName, bytes)).id;
    } catch {
      // The only expected failure is the magic-byte check: not a real PDF.
      return this.say(ctx, 'notPdf');
    }
    await recordEvent(this.db, ctx.userId, 'resume_uploaded');

    const active = await this.resumes.getActive(ctx.userId);
    if (!active?.extractedText.trim()) return this.say(ctx, 'noText');
    await this.analyzeAndShow(ctx, resumeId, active.extractedText);
  }

  /** One analysis (or the fallback), stored as an unconfirmed profile, then shown. */
  private async analyzeAndShow(ctx: BotMessageContext, resumeId: string, text: string): Promise<void> {
    const profile = await this.analyze(ctx, resumeId, text);
    await this.profiles.replace(ctx.userId, profile);

    if (profile.evaluation) {
      await this.bot.sendToUser(ctx.userId, evaluationMessage(ctx.language, profile.evaluation), {
        parseMode: 'HTML',
      });
    }
    const card = profileCard(ctx.language, profile, { fallback: profile.source === 'fallback' });
    await this.bot.sendToUser(ctx.userId, card.text, { parseMode: 'HTML', keyboard: card.keyboard });
  }

  private async analyze(ctx: BotMessageContext, resumeId: string, text: string): Promise<ProfileWrite> {
    const owner = isOwnerRole(ctx.role);
    try {
      const reply = await this.llm.complete({
        ...buildAnalysisPrompt(text, ctx.language),
        // The owner's own resume may use the full chain; strangers' may not.
        providers: owner ? undefined : this.resumeProviders,
      });
      const analysis = parseAnalysis(reply.text);
      if (analysis) {
        await recordEvent(this.db, ctx.userId, 'resume_analyzed', {
          source: 'llm',
          provider: reply.provider,
        });
        return {
          resumeId,
          source: 'llm',
          promptVersion: ANALYSIS_PROMPT_VERSION,
          role: analysis.role,
          grade: analysis.grade,
          years: analysis.years,
          skills: analysis.skills,
          english: analysis.english,
          location: analysis.location,
          salaryUsd: analysis.salaryUsd,
          evaluation: analysis.evaluation,
        };
      }
      this.logger.warn(`resume analysis for ${ctx.userId} returned unusable JSON`);
    } catch (err) {
      this.logger.warn(
        `resume analysis for ${ctx.userId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await recordEvent(this.db, ctx.userId, 'resume_analyzed', { source: 'fallback' });
    const fallback = fallbackProfile(text);
    return {
      resumeId,
      source: 'fallback',
      promptVersion: ANALYSIS_PROMPT_VERSION,
      role: fallback.role,
      grade: fallback.grade,
      years: null,
      skills: fallback.skills,
      english: null,
      location: null,
      salaryUsd: null,
      evaluation: null,
    };
  }

  private async limitReached(ctx: { userId: string; role: string }): Promise<boolean> {
    if (isOwnerRole(ctx.role)) return false;
    return (await this.profiles.analysesInWindow(ctx.userId)) >= RESUME_ANALYSES_PER_WINDOW;
  }

  // -------------------------------------------------------------------------
  // Confirmation and edits
  // -------------------------------------------------------------------------

  async onCallback(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    const [, action, value] = ctx.parts;
    // These two need no profile: they are how a new user gets one.
    if (action === 'res') {
      await this.showResume(ctx);
      return {};
    }
    if (action === 'setup') {
      await this.showSetup(ctx);
      return {};
    }
    const profile = await this.profiles.get(ctx.userId);
    if (!profile) return { alert: profileText(ctx.language, 'noProfile') };

    switch (action) {
      case 'ok':
        await this.profiles.confirm(ctx.userId);
        await recordEvent(this.db, ctx.userId, 'profile_confirmed', { source: profile.source });
        return {
          editText: `${this.profileBlock(ctx, profile)}\n\n${escapeHtml(profileText(ctx.language, 'confirmed'))}`,
          editKeyboard: null,
        };
      case 'card':
        return this.cardResult(ctx, profile);
      case 'g':
      case 'e':
      case 'r':
        if (!value) {
          const prompt: ProfileTextKey =
            action === 'g' ? 'pickGrade' : action === 'e' ? 'pickEnglish' : 'pickRole';
          return {
            editText: escapeHtml(profileText(ctx.language, prompt)),
            editKeyboard: pickerKeyboard(ctx.language, action),
          };
        }
        return this.applyPick(ctx, action, value);
      case 's':
        await this.dialogs.open(ctx.chatId, { userId: ctx.userId, flow: FLOW, step: 'skills', payload: {} });
        await this.say(ctx, 'askSkills');
        return {};
      case 'retry':
        return this.retry(ctx, profile);
      default:
        return {};
    }
  }

  private async applyPick(
    ctx: BotCallbackContext,
    field: 'g' | 'e' | 'r',
    value: string,
  ): Promise<BotCallbackResult> {
    if (field === 'g' && (SENIORITY_LEVELS as readonly string[]).includes(value)) {
      await this.profiles.update(ctx.userId, { grade: value });
    } else if (field === 'e' && (ENGLISH_LEVELS as readonly string[]).includes(value)) {
      await this.profiles.update(ctx.userId, { english: value });
    } else if (field === 'r' && ROLE_TITLES[value]) {
      await this.profiles.update(ctx.userId, { role: ROLE_TITLES[value] });
    }
    const updated = await this.profiles.get(ctx.userId);
    return updated ? this.cardResult(ctx, updated) : {};
  }

  private async retry(ctx: BotCallbackContext, profile: CandidateProfileRow): Promise<BotCallbackResult> {
    if (await this.limitReached(ctx)) {
      return {
        alert: profileText(ctx.language, 'limit', {
          n: RESUME_ANALYSES_PER_WINDOW,
          days: RESUME_ANALYSIS_WINDOW_DAYS,
        }),
      };
    }
    const active = await this.resumes.getActive(ctx.userId);
    if (!active?.extractedText.trim()) return { alert: profileText(ctx.language, 'noProfile') };
    void this.analyzeAndShow(ctx, profile.resumeId ?? active.id, active.extractedText).catch((err) =>
      this.logger.error(`re-analysis failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    // The old card loses its buttons: a new one follows with the new analysis.
    return {
      alert: profileText(ctx.language, 'reading'),
      editText: this.profileBlock(ctx, profile),
      editKeyboard: null,
    };
  }

  /** Typed skills list, the one free-text answer of the dialog. */
  async onSkillsText(ctx: BotMessageContext, text: string): Promise<void> {
    const skills = parseSkillsInput(text);
    if (skills.length === 0) return this.say(ctx, 'badSkills');
    await this.profiles.update(ctx.userId, { skills });
    await this.dialogs.close(ctx.chatId);
    const profile = await this.profiles.get(ctx.userId);
    if (!profile) return this.say(ctx, 'noProfile');
    const card = this.card(ctx, profile);
    await this.bot.sendToUser(ctx.userId, card.text, { parseMode: 'HTML', keyboard: card.keyboard });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private card(ctx: { language: BotMessageContext['language'] }, profile: CandidateProfileRow) {
    return profileCard(ctx.language, profile, { fallback: profile.source === 'fallback' });
  }

  /** The card's field lines without the hint and buttons, for a card that is done. */
  private profileBlock(ctx: { language: BotMessageContext['language'] }, profile: CandidateProfileRow): string {
    return this.card(ctx, profile).text.split('\n\n')[0] ?? '';
  }

  private cardResult(ctx: BotCallbackContext, profile: CandidateProfileRow): BotCallbackResult {
    const card = this.card(ctx, profile);
    return { editText: card.text, editKeyboard: card.keyboard };
  }

  private async say(ctx: { userId: string; language: BotMessageContext['language'] }, key: ProfileTextKey): Promise<void> {
    await this.bot.sendToUser(ctx.userId, escapeHtml(profileText(ctx.language, key)), { parseMode: 'HTML' });
  }

  private async sayLimit(ctx: BotMessageContext): Promise<void> {
    const text = profileText(ctx.language, 'limit', {
      n: RESUME_ANALYSES_PER_WINDOW,
      days: RESUME_ANALYSIS_WINDOW_DAYS,
    });
    await this.bot.sendToUser(ctx.userId, escapeHtml(text), { parseMode: 'HTML' });
  }
}
