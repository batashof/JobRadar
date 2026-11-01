import { ownerChats, sendTelegramMessage } from './owner-telegram';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

describe('sendTelegramMessage', () => {
  beforeEach(() => fetchMock.mockReset());

  it('posts the message without a link preview and reports success as null', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    await expect(sendTelegramMessage('T', { chat_id: '42', text: 'hi' })).resolves.toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botT/sendMessage');
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '42',
      text: 'hi',
      link_preview_options: { is_disabled: true },
    });
  });

  it("returns Telegram's reason instead of failing silently", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ ok: false, description: 'Bad Request: message is too long' }),
    });
    await expect(sendTelegramMessage('T', { chat_id: '42', text: 'x' })).resolves.toBe(
      'HTTP 400: Bad Request: message is too long',
    );
  });

  it('turns a network fault into a reason, never a throw', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(sendTelegramMessage('T', { chat_id: '42', text: 'x' })).resolves.toBe('fetch failed');
  });
});

describe('ownerChats', () => {
  it('keeps linked chats and reads any language but English as Russian', async () => {
    const rows = [
      { chatId: '1', language: 'en' },
      { chatId: '2', language: 'ru' },
      { chatId: null, language: 'en' },
    ];
    const builder = { from: () => builder, innerJoin: () => builder, where: () => Promise.resolve(rows) };
    const db = { select: () => builder } as never;
    await expect(ownerChats(db)).resolves.toEqual([
      { chatId: '1', language: 'en' },
      { chatId: '2', language: 'ru' },
    ]);
  });
});
