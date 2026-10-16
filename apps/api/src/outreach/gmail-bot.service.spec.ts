import type { BotCallbackContext, BotMessageContext } from '../bot/bot.service';
import { GmailBotService, gmailKeyboard } from './gmail-bot.service';

function setup(status = { configured: true, connected: false }) {
  const bot = {
    registerCommand: jest.fn(),
    registerCallback: jest.fn(),
    sendToUser: jest.fn().mockResolvedValue('1'),
  };
  const gmail = {
    statusFor: jest.fn().mockResolvedValue(status),
    authUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?state=s'),
    isConfigured: jest.fn().mockReturnValue(status.configured),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
  const service = new GmailBotService(bot as never, gmail as never);
  return { service, bot, gmail };
}

const msg = (role: 'owner' | 'user' = 'owner'): BotMessageContext => ({
  userId: 'u1',
  chatId: '42',
  language: 'en',
  role,
});

const press = (parts: string[], role: 'owner' | 'user' = 'owner'): BotCallbackContext => ({
  ...msg(role),
  messageId: 7,
  parts,
});

describe('gmailKeyboard', () => {
  it('offers only the consent link when not connected', () => {
    expect(gmailKeyboard('en', false, 'https://x')).toEqual([
      [{ text: '🔗 Connect Gmail', url: 'https://x' }],
    ]);
  });

  it('adds disconnect when connected', () => {
    expect(gmailKeyboard('ru', true, 'https://x')).toEqual([
      [{ text: '🔄 Переподключить', url: 'https://x' }],
      [{ text: '✖️ Отключить', callbackData: 'g:x' }],
    ]);
  });
});

describe('GmailBotService', () => {
  it('registers /gmail and the g: namespace', () => {
    const { service, bot } = setup();
    service.onModuleInit();
    expect(bot.registerCommand).toHaveBeenCalledWith('gmail', expect.any(Function));
    expect(bot.registerCallback).toHaveBeenCalledWith('g', expect.any(Function));
  });

  it('refuses non-owners without touching Gmail', async () => {
    const { service, bot, gmail } = setup();
    await service.show(msg('user'));
    expect(bot.sendToUser).toHaveBeenCalledWith('u1', expect.stringContaining('author only'));
    expect(gmail.statusFor).not.toHaveBeenCalled();
    expect(await service.onCallback(press(['g', 'x'], 'user'))).toEqual({
      alert: expect.stringContaining('author only'),
    });
    expect(gmail.disconnect).not.toHaveBeenCalled();
  });

  it('says so when the server has no Google credentials', async () => {
    const { service, bot, gmail } = setup({ configured: false, connected: false });
    await service.show(msg());
    expect(bot.sendToUser).toHaveBeenCalledWith('u1', expect.stringContaining('not set up'));
    expect(gmail.authUrl).not.toHaveBeenCalled();
  });

  it('shows the status with a signed consent link', async () => {
    const { service, bot, gmail } = setup({ configured: true, connected: true });
    await service.show(msg());
    expect(gmail.authUrl).toHaveBeenCalledWith('u1');
    expect(bot.sendToUser).toHaveBeenCalledWith('u1', expect.stringContaining('is connected'), {
      keyboard: gmailKeyboard('en', true, 'https://accounts.google.com/o/oauth2/v2/auth?state=s'),
    });
  });

  it('disconnects and turns the message back into the connect offer', async () => {
    const { service, gmail } = setup({ configured: true, connected: true });
    const result = await service.onCallback(press(['g', 'x']));
    expect(gmail.disconnect).toHaveBeenCalledWith('u1');
    expect(result).toEqual({
      alert: 'Gmail disconnected.',
      editText: expect.stringContaining('not connected'),
      editKeyboard: [[{ text: '🔗 Connect Gmail', url: expect.any(String) }]],
    });
  });

  it('ignores unknown actions', async () => {
    const { service, gmail } = setup();
    expect(await service.onCallback(press(['g', 'zz']))).toEqual({});
    expect(gmail.disconnect).not.toHaveBeenCalled();
  });
});
