import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProfileCreateInput, ProfileUpdateInput } from '@jobradar/shared';
import { and, desc, eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { searchProfiles } from '../db/schema';
import { MatchingService } from '../matching/matching.service';

// Columns returned to clients (everything except the owning user_id).
const columns = {
  id: searchProfiles.id,
  name: searchProfiles.name,
  keywords: searchProfiles.keywords,
  stack: searchProfiles.stack,
  workFormat: searchProfiles.workFormat,
  employmentType: searchProfiles.employmentType,
  salaryMin: searchProfiles.salaryMin,
  salaryMax: searchProfiles.salaryMax,
  salaryCurrency: searchProfiles.salaryCurrency,
  isActive: searchProfiles.isActive,
  createdAt: searchProfiles.createdAt,
  updatedAt: searchProfiles.updatedAt,
};

/** Drops undefined keys so a partial update only touches the fields it was given. */
function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly matching: MatchingService,
  ) {}

  list(userId: string) {
    return this.db
      .select(columns)
      .from(searchProfiles)
      .where(eq(searchProfiles.userId, userId))
      .orderBy(desc(searchProfiles.createdAt));
  }

  async create(userId: string, input: ProfileCreateInput) {
    const [row] = await this.db
      .insert(searchProfiles)
      .values({ ...input, userId })
      .returning(columns);
    if (!row) throw new Error('Profile insert returned no row');
    // Matches are ready as soon as the client sees the profile.
    await this.matching.rematchProfile(row.id);
    return row;
  }

  async update(userId: string, id: string, input: ProfileUpdateInput) {
    const [row] = await this.db
      .update(searchProfiles)
      .set({ ...definedOnly(input), updatedAt: new Date() })
      .where(and(eq(searchProfiles.id, id), eq(searchProfiles.userId, userId)))
      .returning(columns);
    if (!row) throw new NotFoundException('Profile not found');
    await this.matching.rematchProfile(row.id);
    return row;
  }

  async remove(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .delete(searchProfiles)
      .where(and(eq(searchProfiles.id, id), eq(searchProfiles.userId, userId)))
      .returning({ id: searchProfiles.id });
    if (!row) throw new NotFoundException('Profile not found');
  }
}
