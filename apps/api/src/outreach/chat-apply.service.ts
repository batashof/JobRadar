import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ApplyContact, BOT_CALLBACK_NAMESPACES, type Language } from '@jobradar/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { type BotCallbackContext, type BotCallbackResult, BotService } from '../bot/bot.service';
import { DB, type Database } from '../db/db.module';
import { applyDrafts, vacancies } from '../db/schema';
import {
  applyText,
  confirmKeyboard,
  renderEmailDraft,
  renderLinkApply,
  renderTelegramApply,
  telegramContactUrl,
} from './chat-apply.text';
import { GmailService } from './gmail.service';
import { OutreachService } from './outreach.service';

/**
 * Applying to a vacancy without leaving Telegram.
 *
 * Three paths, keyed on `vacancies.apply_contact` — the same split the vacancy
 * page uses, because the contact is what decides how an application can be
 * delivered at all:
 *   `email`    → drafted here, reviewed in the chat, sent via Gmail on confirm;
 *   `telegram` → ready-to-paste letter plus a button to the contact's chat;
 *   `url`/none → ready-to-paste letter plus a link into the app and the posting.
 *
 * Registered under its own `a:` namespace rather than the digest's, so any
 * surface that offers "apply" reuses this handler.
 */
@Injectable()
export class ChatApplyService implements OnModuleInit {
  private readonly logger = new Logger(ChatApplyService.name);
  private readonly webOrigin: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
    private readonly outreach: OutreachService,
    private readonly gmail: GmailService,
    config: ConfigService,
  ) {
    this.webOrigin = (config.get<string>('WEB_ORIGIN') ?? '').replace(/\/$/, '');
  }

  onModuleInit(): void {
    this.bot.registerCallback(BOT_CALLBACK_NAMESPACES.apply, (ctx) => this.handle(ctx));
  }

  private async handle(ctx: BotCallbackContext): Promise<BotCallbackResult> {
    const [, action, id] = ctx.parts;
    if (!action || !id) return {};

    switch (action) {
      case 'd':
        // Drafting means an LLM call — far longer than Telegram's callback
        // answer window. Acknowledge now, deliver the draft as its own message.
        void this.prepare(ctx.userId, id, ctx.language).catch((err) => {
          this.logger.error(
            `apply draft failed for vacancy ${id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          void this.bot.sendToUser(ctx.userId, applyText(ctx.language, 'failed'));
        });
        return { alert: applyText(ctx.language, 'preparing') };
      case 's':
        return this.send(ctx.userId, id, ctx.language);
      case 'x':
        return this.cancel(ctx.userId, id, ctx.language);
      default:
        return {};
    }
  }

  // -------------------------------------------------------------------------
  // Drafting
  // -------------------------------------------------------------------------

  private async prepare(userId: string, vacancyId: string, lang: Language): Promise<void> {
    const [vacancy] = await this.db
      .select({ title: vacancies.title, url: vacancies.url, contact: vacancies.applyContact })
      .from(vacancies)
      .where(eq(vacancies.id, vacancyId));
    if (!vacancy) return;

    const contact = vacancy.contact as ApplyContact | null;
    const { coverLetter } = await this.outreach.coverLetter(userId, vacancyId);

    if (contact?.kind === 'email') {
      await this.prepareEmail(userId, vacancyId, vacancy.title, coverLetter, lang);
      return;
    }

    if (contact?.kind === 'telegram') {
      const url = telegramContactUrl(contact.value);
      await this.bot.sendToUser(
        userId,
        renderTelegramApply(lang, contact.value, coverLetter),
        {
          parseMode: 'HTML',
          disablePreview: true,
          keyboard: url ? [[{ text: applyText(lang, 'openChat'), url }]] : undefined,
        },
      );
      return;
    }

    // A web form, or no contact at all: the letter is the useful part.
    await this.bot.sendToUser(userId, renderLinkApply(lang, coverLetter), {
      parseMode: 'HTML',
      disablePreview: true,
      keyboard: [
        [
          ...(this.webOrigin
            ? [
                {
                  text: applyText(lang, 'openApp'),
                  url: `${this.webOrigin}/app/vacancies/${vacancyId}`,
                },
              ]
            : []),
          { text: applyText(lang, 'openPosting'), url: contact?.value ?? vacancy.url },
        ],
      ],
    });
  }

  private async prepareEmail(
    userId: string,
    vacancyId: string,
    title: string,
    coverLetter: string,
    lang: Language,
  ): Promise<void> {
    // Sending needs a connected Gmail account; say so before spending a draft.
    const status = await this.gmail.statusFor(userId);
    if (!status.connected) {
      await this.bot.sendToUser(userId, applyText(lang, 'noGmail'), {
        keyboard: this.webOrigin
          ? [[{ text: applyText(lang, 'openApp'), url: `${this.webOrigin}/app/vacancies/${vacancyId}` }]]
          : undefined,
      });
      return;
    }

    const draft = await this.outreach.draftApplyEmail(userId, vacancyId, coverLetter);
    const [row] = await this.db
      .insert(applyDrafts)
      .values({
        userId,
        vacancyId,
        recipient: draft.recipient,
        subject: draft.subject,
        body: draft.body,
      })
      .returning({ id: applyDrafts.id });
    if (!row) return;

    await this.bot.sendToUser(userId, renderEmailDraft(lang, draft, title), {
      parseMode: 'HTML',
      disablePreview: true,
      keyboard: confirmKeyboard(lang, row.id),
    });
  }

  // -------------------------------------------------------------------------
  // Confirming
  // -------------------------------------------------------------------------

  private async send(
    userId: string,
    draftId: string,
    lang: Language,
  ): Promise<BotCallbackResult> {
    const [draft] = await this.db
      .select()
      .from(applyDrafts)
      .where(and(eq(applyDrafts.id, draftId), eq(applyDrafts.userId, userId)));
    if (!draft) return { alert: applyText(lang, 'expired') };
    if (draft.sentAt) return { alert: applyText(lang, 'alreadySent') };

    // Claim the draft before sending: two quick taps must not send twice.
    const claimed = await this.db
      .update(applyDrafts)
      .set({ sentAt: new Date() })
      .where(and(eq(applyDrafts.id, draftId), isNull(applyDrafts.sentAt)))
      .returning({ id: applyDrafts.id });
    if (claimed.length === 0) return { alert: applyText(lang, 'alreadySent') };

    try {
      // Reuses the app's own path, so the outreach record and the kanban move
      // happen exactly as they do when sending from the vacancy page.
      await this.outreach.sendApplyEmail(userId, draft.vacancyId, {
        recipient: draft.recipient,
        subject: draft.subject,
        body: draft.body,
      });
    } catch (err) {
      // Release the claim so the user can retry after fixing the cause.
      await this.db
        .update(applyDrafts)
        .set({ sentAt: null })
        .where(eq(applyDrafts.id, draftId));
      this.logger.warn(
        `apply send failed for draft ${draftId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { alert: applyText(lang, 'sendFailed') };
    }

    return {
      alert: applyText(lang, 'sent'),
      editText: applyText(lang, 'sent'),
      editKeyboard: null,
    };
  }

  private async cancel(
    userId: string,
    draftId: string,
    lang: Language,
  ): Promise<BotCallbackResult> {
    await this.db
      .delete(applyDrafts)
      .where(and(eq(applyDrafts.id, draftId), eq(applyDrafts.userId, userId)));
    return {
      alert: applyText(lang, 'cancelled'),
      editText: applyText(lang, 'cancelled'),
      editKeyboard: null,
    };
  }
}
