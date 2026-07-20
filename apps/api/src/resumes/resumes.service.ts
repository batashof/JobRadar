import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ResumeItem } from '@jobradar/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { PDFParse } from 'pdf-parse';

import { DB, type Database } from '../db/db.module';
import { resumes } from '../db/schema';
import { looksLikePdf, normalizeExtractedText } from './pdf-text';

// Everything except the file bytes and the owning user_id.
const itemColumns = {
  id: resumes.id,
  filename: resumes.filename,
  isActive: resumes.isActive,
  uploadedAt: resumes.uploadedAt,
  extractedChars: sql<number>`length(${resumes.extractedText})`,
};

type ItemRow = {
  id: string;
  filename: string;
  isActive: boolean;
  uploadedAt: Date;
  extractedChars: number;
};

function toItem(row: ItemRow): ResumeItem {
  return { ...row, uploadedAt: row.uploadedAt.toISOString() };
}

@Injectable()
export class ResumesService {
  private readonly logger = new Logger(ResumesService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async list(userId: string): Promise<ResumeItem[]> {
    const rows = await this.db
      .select(itemColumns)
      .from(resumes)
      .where(eq(resumes.userId, userId))
      .orderBy(desc(resumes.uploadedAt));
    return rows.map(toItem);
  }

  /** Uploads a PDF, extracts its text, and makes it the active resume. */
  async upload(userId: string, filename: string, file: Buffer): Promise<ResumeItem> {
    if (!looksLikePdf(file)) {
      throw new BadRequestException('Only PDF files are accepted');
    }

    let extractedText = '';
    const parser = new PDFParse({ data: file });
    try {
      const parsed = await parser.getText();
      extractedText = normalizeExtractedText(parsed.text ?? '');
    } catch (err) {
      // A resume whose text we cannot read is still stored and downloadable;
      // LLM features will report the missing text when asked to use it.
      this.logger.warn(`PDF text extraction failed for "${filename}": ${String(err)}`);
    } finally {
      await parser.destroy().catch(() => undefined);
    }

    const row = await this.db.transaction(async (tx) => {
      await tx.update(resumes).set({ isActive: false }).where(eq(resumes.userId, userId));
      const [inserted] = await tx
        .insert(resumes)
        .values({ userId, filename, file, extractedText, isActive: true })
        .returning(itemColumns);
      if (!inserted) throw new Error('Resume insert returned no row');
      return inserted;
    });
    return toItem(row);
  }

  async getFile(userId: string, id: string): Promise<{ filename: string; file: Buffer }> {
    const [row] = await this.db
      .select({ filename: resumes.filename, file: resumes.file })
      .from(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)));
    if (!row) throw new NotFoundException('Resume not found');
    return row;
  }

  /** Marks one resume active and the user's others inactive. */
  async activate(userId: string, id: string): Promise<ResumeItem> {
    const row = await this.db.transaction(async (tx) => {
      await tx.update(resumes).set({ isActive: false }).where(eq(resumes.userId, userId));
      const [updated] = await tx
        .update(resumes)
        .set({ isActive: true })
        .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
        .returning(itemColumns);
      return updated;
    });
    if (!row) throw new NotFoundException('Resume not found');
    return toItem(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    try {
      const [row] = await this.db
        .delete(resumes)
        .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
        .returning({ id: resumes.id });
      if (!row) throw new NotFoundException('Resume not found');
    } catch (err) {
      // 23503 = foreign_key_violation: the resume was attached to a sent
      // application email — keep it for the record.
      if (isFkViolation(err)) {
        throw new ConflictException('Resume was used in a sent application and cannot be deleted');
      }
      throw err;
    }
  }

  /** The active resume with its extracted text, for LLM features. Null when none. */
  async getActive(
    userId: string,
  ): Promise<{ id: string; filename: string; extractedText: string } | null> {
    const [row] = await this.db
      .select({
        id: resumes.id,
        filename: resumes.filename,
        extractedText: resumes.extractedText,
      })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isActive, true)))
      .orderBy(desc(resumes.uploadedAt))
      .limit(1);
    return row ?? null;
  }
}

function isFkViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code ?? (err as { cause?: { code?: unknown } }).cause?.code;
  return code === '23503';
}
