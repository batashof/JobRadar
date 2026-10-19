import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { join } from 'node:path';
import { Client, Pool } from 'pg';

import { DB, type Database } from '../../../src/db/db.module';
import * as schema from '../../../src/db/schema';
import { SEED_SOURCES } from '../../../src/db/seed-data';
import type { TelegramUpdate } from '../../../src/bot/bot-update';
import { TELEGRAM_SECRET_HEADER } from '../../../src/bot/bot-webhook.guard';
import { FakeTelegram, type SentMessage } from './fake-telegram';

/**
 * Boots the whole API (every module, real Postgres and Redis) with Telegram
 * replaced by `FakeTelegram`, and drives the bot the way Telegram does: HTTP
 * POSTs of updates to the webhook. No secrets and no network beyond localhost.
 *
 * The database is wiped before each suite, so it must be a throwaway one:
 * `E2E_DATABASE_URL` defaults to a `jobradar_e2e` database next to the
 * docker-compose one and is refused unless it points at this machine.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://jobradar:jobradar@localhost:5432/jobradar_e2e';
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379';
const WEBHOOK_SECRET = 'e2e-webhook-secret';

export interface E2eApp {
  app: INestApplication;
  db: Database;
  telegram: FakeTelegram;
  baseUrl: string;
  /** POSTs an update to the webhook; resolves with the HTTP status. */
  post(update: TelegramUpdate, secret?: string | null): Promise<number>;
  close(): Promise<void>;
}

function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', 'postgres', '::1'].includes(host)) {
    throw new Error(`E2E_DATABASE_URL must point at a local throwaway database, not ${host}`);
  }
}

/** Creates the database when missing, migrates it and empties every table. */
export async function prepareDatabase(url = E2E_DATABASE_URL): Promise<void> {
  assertLocal(url);
  const target = new URL(url);
  const name = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) await client.query(`create database "${name.replace(/"/g, '')}"`);
  } finally {
    await client.end();
  }

  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: join(__dirname, '../../../drizzle') });
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    if (rows.length > 0) {
      await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(', ')} restart identity cascade`);
    }
    await db.insert(schema.sources).values(SEED_SOURCES);
  } finally {
    await pool.end();
  }
}

/** A fresh database and a running app on a random port. */
export async function startApp(): Promise<E2eApp> {
  await prepareDatabase();

  Object.assign(process.env, {
    DATABASE_URL: E2E_DATABASE_URL,
    REDIS_URL: E2E_REDIS_URL,
    TELEGRAM_BOT_TOKEN: '123456:e2e-test-token',
    TELEGRAM_BOT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    // The in-process timers would race the scenarios; tests call the services.
    DIGEST_DISABLED: '1',
    PLANNER_TICK_DISABLED: '1',
    APPLICATION_REMINDERS_DISABLED: '1',
  });
  // No LLM key reaches the app: resume analysis takes its rule-based fallback,
  // the same path production takes when every free provider is down.
  for (const key of ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'SENTRY_DSN']) {
    delete process.env[key];
  }

  const telegram = new FakeTelegram();
  telegram.install();

  // Imported after the env is set: ConfigModule reads it at import time.
  const { AppModule } = await import('../../../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const db = app.get<Database>(DB);

  return {
    app,
    db,
    telegram,
    baseUrl,
    async post(update, secret = WEBHOOK_SECRET) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (secret !== null) headers[TELEGRAM_SECRET_HEADER] = secret;
      const response = await fetch(`${baseUrl}/bot/telegram/webhook`, {
        method: 'POST',
        headers,
        body: JSON.stringify(update),
      });
      return response.status;
    },
    async close() {
      await app.close();
      await (db as unknown as { $client: Pool }).$client.end();
      telegram.uninstall();
    },
  };
}

/** Polls until `check` returns a value (not undefined/false), or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => T | undefined | false | Promise<T | undefined | false>,
  what: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let updateId = 1;
let callbackId = 1;

/**
 * One person in a private chat with the bot. Each action is an update posted
 * to the webhook; `say`/`press` resolve once the webhook has answered, and the
 * replies are read from `FakeTelegram`.
 */
export class ChatUser {
  constructor(
    private readonly e2e: E2eApp,
    readonly id: number,
    readonly languageCode = 'ru',
    readonly username = `user${id}`,
  ) {}

  private get from() {
    return { id: this.id, username: this.username, is_bot: false, language_code: this.languageCode };
  }

  async say(text: string): Promise<void> {
    const status = await this.e2e.post({
      update_id: updateId++,
      message: { message_id: updateId, text, chat: { id: this.id, type: 'private' }, from: this.from },
    });
    expect(status).toBe(200);
  }

  async sendDocument(fileId: string, fileName: string, bytes: Buffer, mimeType = 'application/pdf'): Promise<void> {
    this.e2e.telegram.addFile(fileId, bytes);
    const status = await this.e2e.post({
      update_id: updateId++,
      message: {
        message_id: updateId,
        document: { file_id: fileId, file_name: fileName, mime_type: mimeType, file_size: bytes.length },
        chat: { id: this.id, type: 'private' },
        from: this.from,
      },
    });
    expect(status).toBe(200);
  }

  /** Presses a button of a message the bot sent to this chat. */
  async press(message: SentMessage, callbackData: string): Promise<void> {
    const button = message.buttons.find((b) => b.callback_data === callbackData);
    if (!button) {
      const offered = message.buttons.map((b) => b.callback_data ?? b.url).join(', ');
      throw new Error(`no button "${callbackData}" on the message; it offers: ${offered}`);
    }
    const status = await this.e2e.post({
      update_id: updateId++,
      callback_query: {
        id: String(callbackId++),
        data: callbackData,
        message: { message_id: message.messageId, chat: { id: this.id } },
        from: { username: this.username },
      },
    });
    expect(status).toBe(200);
  }

  messages(): SentMessage[] {
    return this.e2e.telegram.messagesTo(this.id);
  }

  last(): SentMessage | undefined {
    return this.messages().at(-1);
  }

  /** The first message to this chat whose visible text matches, once it arrives. */
  async waitForMessage(pattern: RegExp, timeoutMs?: number): Promise<SentMessage> {
    return waitFor(
      () => this.messages().find((m) => pattern.test(m.text)),
      `a message matching ${pattern} in chat ${this.id}`,
      timeoutMs,
    );
  }
}

/** Rows of `events` with this name, newest last. */
export async function eventsNamed(db: Database, name: string) {
  const { rows } = await db.execute<{ user_id: string | null; props: Record<string, unknown> | null }>(
    sql`select user_id, props from events where name = ${name} order by created_at`,
  );
  return rows;
}
