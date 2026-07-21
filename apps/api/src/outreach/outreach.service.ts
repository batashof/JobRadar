import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ApplyContact,
  ApplyEmailDraft,
  ApplyEmailSendInput,
  ApplyEmailSendResult,
  BriefResponse,
  CoverLetterResponse,
} from '@jobradar/shared';
import { and, eq, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { applications, outreachEmails, users, vacancies } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { ResumesService } from '../resumes/resumes.service';
import { GmailService } from './gmail.service';
import {
  buildApplyEmailPrompt,
  buildBriefPrompt,
  buildCoverLetterPrompt,
  parseApplyEmail,
  type VacancyPromptInput,
} from './prompts';

@Injectable()
export class OutreachService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
    private readonly resumes: ResumesService,
    private readonly gmail: GmailService,
  ) {}

  /**
   * Russian brief for the vacancy — generated on demand, cached permanently on
   * the vacancy row (ADR-005 token discipline). `force` regenerates.
   */
  async brief(userId: string, vacancyId: string, force = false): Promise<BriefResponse> {
    const vacancy = await this.loadVacancy(vacancyId);

    if (vacancy.summaryRu && vacancy.summaryGeneratedAt && !force) {
      return {
        summaryRu: vacancy.summaryRu,
        generatedAt: vacancy.summaryGeneratedAt.toISOString(),
        cached: true,
      };
    }

    const resume = await this.resumes.getActive(userId);
    const prompt = buildBriefPrompt(vacancy, resume?.extractedText || null);
    const result = await this.llm.complete({ ...prompt, maxTokens: 700 });

    const generatedAt = new Date();
    await this.db
      .update(vacancies)
      .set({ summaryRu: result.text, summaryGeneratedAt: generatedAt })
      .where(eq(vacancies.id, vacancyId));

    return { summaryRu: result.text, generatedAt: generatedAt.toISOString(), cached: false };
  }

  /** Cover letter grounded in the active resume — not cached, user edits before use. */
  async coverLetter(userId: string, vacancyId: string): Promise<CoverLetterResponse> {
    const vacancy = await this.loadVacancy(vacancyId);

    const resume = await this.resumes.getActive(userId);
    if (!resume) {
      throw new BadRequestException('Upload a resume first — the letter is built from it');
    }
    if (!resume.extractedText) {
      throw new BadRequestException(
        'No text could be extracted from the active resume — upload a text-based PDF',
      );
    }

    const prompt = buildCoverLetterPrompt(vacancy, resume.extractedText);
    const result = await this.llm.complete({ ...prompt, maxTokens: 600, temperature: 0.5 });
    return { coverLetter: result.text };
  }

  /**
   * LLM-drafted application email (subject + body around the user's cover
   * letter). Nothing is sent here — the user reviews and confirms in the UI.
   */
  async draftApplyEmail(
    userId: string,
    vacancyId: string,
    coverLetter: string,
  ): Promise<ApplyEmailDraft> {
    const vacancy = await this.loadVacancy(vacancyId);
    const [user] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    const candidateEmail = user?.email ?? '';

    const contact = vacancy.applyContact as ApplyContact | null;
    const recipient = contact?.kind === 'email' ? contact.value : '';

    const prompt = buildApplyEmailPrompt(vacancy, coverLetter, candidateEmail);
    const result = await this.llm.complete({ ...prompt, maxTokens: 700 });
    const parsed = parseApplyEmail(result.text);
    if (parsed) return { recipient, ...parsed };

    // The model ignored the format — still give the user something sendable.
    return {
      recipient,
      subject: `${vacancy.title} — application`,
      body: `${coverLetter}\n\nMy resume is attached as a PDF.`,
    };
  }

  /** Sends the confirmed email via Gmail, records it, and updates the kanban. */
  async sendApplyEmail(
    userId: string,
    vacancyId: string,
    input: ApplyEmailSendInput,
  ): Promise<ApplyEmailSendResult> {
    await this.loadVacancy(vacancyId); // 404 before any side effect

    const active = await this.resumes.getActive(userId);
    if (!active) {
      throw new BadRequestException('Upload a resume first — it is attached to the email');
    }
    const { filename, file } = await this.resumes.getFile(userId, active.id);

    const gmailMessageId = await this.gmail.sendEmail(userId, {
      to: input.recipient,
      subject: input.subject,
      bodyText: input.body,
      attachment: { filename, contentType: 'application/pdf', content: file },
    });

    const [outreach] = await this.db
      .insert(outreachEmails)
      .values({
        userId,
        vacancyId,
        resumeId: active.id,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        gmailMessageId,
      })
      .returning({ id: outreachEmails.id, sentAt: outreachEmails.sentAt });
    if (!outreach) throw new Error('Outreach insert returned no row');

    await this.reflectOnBoard(userId, vacancyId);

    return {
      outreachId: outreach.id,
      gmailMessageId,
      sentAt: outreach.sentAt.toISOString(),
    };
  }

  /** A sent application means the vacancy is at least in the "applied" stage. */
  private async reflectOnBoard(userId: string, vacancyId: string): Promise<void> {
    const now = new Date();
    const [existing] = await this.db
      .select({ id: applications.id, stage: applications.stage })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.vacancyId, vacancyId)));

    if (!existing) {
      await this.db.insert(applications).values({
        userId,
        vacancyId,
        stage: 'applied',
        furthestStage: 'applied',
        appliedAt: now,
        lastActivityAt: now,
      });
      return;
    }
    if (existing.stage === 'saved') {
      await this.db
        .update(applications)
        .set({
          stage: 'applied',
          // 'applied' is the funnel floor; anything further was already recorded.
          furthestStage: sql`greatest(${applications.furthestStage}, 'applied'::application_stage)`,
          appliedAt: now,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(eq(applications.id, existing.id));
      return;
    }
    await this.db
      .update(applications)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(applications.id, existing.id));
  }

  private async loadVacancy(id: string): Promise<
    VacancyPromptInput & {
      summaryRu: string | null;
      summaryGeneratedAt: Date | null;
      applyContact: unknown;
    }
  > {
    const [row] = await this.db
      .select({
        title: vacancies.title,
        company: vacancies.companyRaw,
        description: vacancies.description,
        location: vacancies.location,
        summaryRu: vacancies.summaryRu,
        summaryGeneratedAt: vacancies.summaryGeneratedAt,
        applyContact: vacancies.applyContact,
      })
      .from(vacancies)
      .where(eq(vacancies.id, id));
    if (!row) throw new NotFoundException('Vacancy not found');
    return row;
  }
}
