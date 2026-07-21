import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GmailStatus } from '@jobradar/shared';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
import { decryptToken, encryptToken, signState, verifyState } from './gmail-crypto';
import { buildMimeMessage, toBase64Url } from './gmail-mime';

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export interface SendEmailInput {
  to: string;
  subject: string;
  bodyText: string;
  attachment: { filename: string; contentType: string; content: Buffer };
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.clientId() && this.clientSecret());
  }

  async statusFor(userId: string): Promise<GmailStatus> {
    if (!this.isConfigured()) return { configured: false, connected: false };
    const [row] = await this.db
      .select({ token: users.gmailRefreshToken })
      .from(users)
      .where(eq(users.id, userId));
    return { configured: true, connected: Boolean(row?.token) };
  }

  /** Consent-screen URL; `state` carries the signed userId for the callback. */
  authUrl(userId: string): string {
    this.assertConfigured();
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: GMAIL_SCOPE,
      access_type: 'offline',
      // Force the consent screen so Google re-issues a refresh token.
      prompt: 'consent',
      state: signState(userId, this.clientSecret()),
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /** Exchanges the callback code and stores the encrypted refresh token. */
  async handleCallback(code: string, state: string): Promise<void> {
    this.assertConfigured();
    const userId = verifyState(state, this.clientSecret());
    if (!userId) throw new BadRequestException('Invalid or expired OAuth state');

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { refresh_token?: string };
    if (!res.ok || !data.refresh_token) {
      this.logger.warn(`Gmail token exchange failed: HTTP ${res.status}`);
      throw new BadRequestException('Gmail authorization failed — try connecting again');
    }

    await this.db
      .update(users)
      .set({ gmailRefreshToken: encryptToken(data.refresh_token, this.clientSecret()) })
      .where(eq(users.id, userId));
  }

  async disconnect(userId: string): Promise<void> {
    await this.db.update(users).set({ gmailRefreshToken: null }).where(eq(users.id, userId));
  }

  /** Sends via the Gmail API from the user's own account; returns the message id. */
  async sendEmail(userId: string, input: SendEmailInput): Promise<string | null> {
    const accessToken = await this.accessTokenFor(userId);

    const [row] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    const from = row?.email ?? 'me';

    const raw = toBase64Url(
      buildMimeMessage({
        from,
        to: input.to,
        subject: input.subject,
        bodyText: input.bodyText,
        attachment: input.attachment,
      }),
    );

    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ raw }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    if (!res.ok) {
      this.logger.warn(`Gmail send failed: HTTP ${res.status}`);
      throw new ServiceUnavailableException('Gmail rejected the message — try again later');
    }
    return data.id ?? null;
  }

  private async accessTokenFor(userId: string): Promise<string> {
    this.assertConfigured();
    const [row] = await this.db
      .select({ token: users.gmailRefreshToken })
      .from(users)
      .where(eq(users.id, userId));
    const refreshToken = row?.token ? decryptToken(row.token, this.clientSecret()) : null;
    if (!refreshToken) {
      throw new BadRequestException('Connect your Gmail account first');
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (!res.ok || !data.access_token) {
      this.logger.warn(`Gmail token refresh failed: HTTP ${res.status}`);
      throw new BadRequestException(
        'Gmail connection expired or was revoked — reconnect your account',
      );
    }
    return data.access_token;
  }

  private clientId(): string {
    return this.config.get<string>('GOOGLE_CLIENT_ID') ?? '';
  }

  private clientSecret(): string {
    return this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? '';
  }

  private redirectUri(): string {
    return (
      this.config.get<string>('GOOGLE_OAUTH_REDIRECT') ??
      'http://localhost:3001/gmail/oauth/callback'
    );
  }

  /** Where to send the browser after the OAuth callback. */
  webOrigin(): string {
    return this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Gmail is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
      );
    }
  }
}
