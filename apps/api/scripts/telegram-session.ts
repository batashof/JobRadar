/**
 * One-off interactive helper: logs into Telegram (MTProto) and prints the
 * session string to store as the TELEGRAM_SESSION secret (ADR-009).
 *
 * Usage:
 *   TELEGRAM_API_ID=... TELEGRAM_API_HASH=... pnpm --filter @jobradar/api telegram:session
 * (or put both vars in the repo-root .env; get them at https://my.telegram.org)
 *
 * The script asks for your phone number, the login code Telegram sends you,
 * and your 2FA password if set. Run it locally; never commit the output.
 */
import { createInterface } from 'node:readline/promises';

import { config } from 'dotenv';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

config({ path: '../../.env' });

async function main(): Promise<void> {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    console.error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH first (see https://my.telegram.org).');
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 3,
  });

  await client.start({
    phoneNumber: () => rl.question('Phone number (international format): '),
    phoneCode: () => rl.question('Login code from Telegram: '),
    password: () => rl.question('2FA password (empty if none): '),
    onError: (err) => {
      console.error(err);
      return true;
    },
  });

  console.log('\nTELEGRAM_SESSION (store as a secret, never commit):\n');
  console.log(client.session.save());
  await client.disconnect();
  rl.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
