/**
 * Registers (or inspects) the Telegram Bot API webhook. Run once per
 * deployment target — Telegram stores the URL on its side, so this is not
 * something the API can do for itself at boot without racing other instances.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_BOT_WEBHOOK_SECRET=... API_ORIGIN=https://jobradar-api.example \
 *     pnpm --filter @jobradar/api bot:webhook
 *   pnpm --filter @jobradar/api bot:webhook -- --info    # just show current state
 *   pnpm --filter @jobradar/api bot:webhook -- --delete  # stop delivery
 *
 * All three vars can live in the repo-root .env. Never commit the token.
 */
import { config } from 'dotenv';

config({ path: '../../.env' });

const API_BASE = 'https://api.telegram.org';

async function call(token: string, method: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    ok: boolean;
    result?: unknown;
    description?: string;
  };
  if (!payload.ok) throw new Error(`${method} failed: ${payload.description ?? response.status}`);
  return payload.result;
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('Set TELEGRAM_BOT_TOKEN first (create a bot via @BotFather).');
    process.exitCode = 1;
    return;
  }

  const mode = process.argv.includes('--delete')
    ? 'delete'
    : process.argv.includes('--info')
      ? 'info'
      : 'set';

  if (mode === 'info') {
    console.log(await call(token, 'getWebhookInfo'));
    return;
  }

  if (mode === 'delete') {
    await call(token, 'deleteWebhook');
    console.log('Webhook deleted — the bot no longer receives updates.');
    return;
  }

  const secret = process.env.TELEGRAM_BOT_WEBHOOK_SECRET;
  const origin = process.env.API_ORIGIN?.replace(/\/$/, '');
  if (!secret || !origin) {
    console.error('Set TELEGRAM_BOT_WEBHOOK_SECRET and API_ORIGIN (the public API URL).');
    process.exitCode = 1;
    return;
  }

  const url = `${origin}/bot/telegram/webhook`;
  await call(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
  });

  const me = (await call(token, 'getMe')) as { username?: string };
  console.log(`Webhook set to ${url}`);
  console.log(`Bot: @${me.username ?? 'unknown'}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
