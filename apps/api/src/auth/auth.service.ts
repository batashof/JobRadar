import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser, LoginInput, SignupInput } from '@jobradar/shared';
import { and, eq, gt } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { sessions, users } from '../db/schema';
import { hashPassword, verifyPassword } from './password';
import { generateSessionToken, SESSION_TTL_MS } from './session';

interface SessionResult {
  user: AuthUser;
  token: string;
  expiresAt: Date;
}

function toAuthUser(row: { id: string; email: string; digestEnabled: boolean }): AuthUser {
  return { id: row.id, email: row.email, digestEnabled: row.digestEnabled };
}

/** Postgres unique_violation. drizzle wraps the pg error, so check the cause chain too. */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ('code' in e && (e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}

@Injectable()
export class AuthService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Registers a new user and opens a session. Rejects duplicate emails. */
  async signup(input: SignupInput): Promise<SessionResult> {
    const passwordHash = await hashPassword(input.password);
    let created: { id: string; email: string; digestEnabled: boolean } | undefined;
    try {
      const [row] = await this.db
        .insert(users)
        .values({ email: input.email, passwordHash })
        .returning({ id: users.id, email: users.email, digestEnabled: users.digestEnabled });
      created = row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Email is already registered');
      }
      throw err;
    }
    if (!created) throw new Error('User insert returned no row');
    const session = await this.createSession(created.id);
    return { user: toAuthUser(created), ...session };
  }

  /** Verifies credentials and opens a session. Same error whether email or password is wrong. */
  async login(input: LoginInput): Promise<SessionResult> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        digestEnabled: users.digestEnabled,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    const ok = row?.passwordHash
      ? await verifyPassword(input.password, row.passwordHash)
      : // Hash a throwaway value so timing does not reveal whether the email exists.
        (await verifyPassword(input.password, ''), false);
    if (!row || !ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const session = await this.createSession(row.id);
    return { user: toAuthUser(row), ...session };
  }

  /** Resolves the user behind a valid, unexpired session token, or null. */
  async validateSession(token: string): Promise<AuthUser | null> {
    if (!token) return null;
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        digestEnabled: users.digestEnabled,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return row ? toAuthUser(row) : null;
  }

  /** Revokes a session (logout). No-op if the token is unknown. */
  async revokeSession(token: string): Promise<void> {
    if (!token) return;
    await this.db.delete(sessions).where(eq(sessions.token, token));
  }

  private async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(sessions).values({ token, userId, expiresAt });
    return { token, expiresAt };
  }
}
