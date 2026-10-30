import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';

import { BotDialogs } from './bot-dialogs';
import { BotService } from './bot.service';
import { menuCommands, OWNER_COMMANDS, PUBLIC_COMMANDS } from './command-menu';

const SRC = join(__dirname, '..');

/** Every `.ts` file under src/ except specs. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Commands the code answers: feature `registerCommand` calls plus the bot's own switch. */
function implementedCommands(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/registerCommand\('([a-z_]+)'/g)) found.add(match[1] ?? '');
  }
  const bot = readFileSync(join(__dirname, 'bot.service.ts'), 'utf8');
  const commandSwitch = bot.slice(bot.indexOf('switch (cmd.command)'));
  for (const match of commandSwitch.slice(0, 2000).matchAll(/case '([a-z_]+)':/g)) found.add(match[1] ?? '');
  return found;
}

describe('command menu', () => {
  it('lists every command the bot answers, and nothing else', () => {
    const menu = [...PUBLIC_COMMANDS, ...OWNER_COMMANDS].map(([command]) => command).sort();
    expect(menu).toEqual([...implementedCommands()].sort());
  });

  it('keeps names and descriptions within Telegram limits', () => {
    for (const lang of ['en', 'ru'] as const) {
      for (const entry of menuCommands(lang, true)) {
        expect(entry.command).toMatch(/^[a-z0-9_]{1,32}$/);
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeLessThanOrEqual(256);
      }
    }
  });

  it('adds the author tools before /help for the owner only', () => {
    expect(menuCommands('en').map((c) => c.command)).not.toContain('plan');
    const owner = menuCommands('ru', true).map((c) => c.command);
    expect(owner.slice(-7)).toEqual(['interview', 'plan', 'gmail', 'testmode', 'stats', 'triage', 'help']);
    expect(menuCommands('ru')[0]).toEqual({
      command: 'start',
      description: 'Создать аккаунт или подключить чат',
    });
  });
});

describe('BotService.publishMenu', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ ok: true, result: true }),
      } as Response),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const makeDb = (owners: { chatId: string | null; language: string }[]) =>
    ({
      select: () => ({
        from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(owners) }) }),
      }),
    }) as never;

  const config = (token?: string) => ({ get: () => token }) as unknown as ConfigService;

  const calls = () =>
    fetchMock.mock.calls.map(([url, init]: [string, RequestInit]) => ({
      method: url.split('/').pop(),
      body: JSON.parse(init.body as string),
    }));

  it('sets the English default, the Russian list and each owner chat', async () => {
    const db = makeDb([{ chatId: '42', language: 'ru' }]);
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));

    await bot.publishMenu();

    const sent = calls();
    expect(sent.map((c) => c.method)).toEqual(['setMyCommands', 'setMyCommands', 'setMyCommands']);
    expect(sent[0]?.body).toEqual({ commands: menuCommands('en') });
    expect(sent[1]?.body).toEqual({ commands: menuCommands('ru'), language_code: 'ru' });
    expect(sent[2]?.body).toEqual({
      commands: menuCommands('ru', true),
      scope: { type: 'chat', chat_id: '42' },
    });
  });

  it('does nothing without a bot token', async () => {
    const db = makeDb([]);
    await new BotService(db, config(undefined), new BotDialogs(db)).publishMenu();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never fails startup when Telegram refuses', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('network down')));
    const db = makeDb([]);
    const bot = new BotService(db, config('123:abc'), new BotDialogs(db));
    expect(() => bot.onApplicationBootstrap()).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
