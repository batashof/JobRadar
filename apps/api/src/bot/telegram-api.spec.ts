import { escapeHtml, TelegramApi, TelegramApiError } from './telegram-api';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const ok = (result: unknown) =>
  Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, result }) } as Response);

const fail = (payload: Record<string, unknown>, status = 400) =>
  Promise.resolve({ status, json: () => Promise.resolve({ ok: false, ...payload }) } as Response);

/** The JSON body the client posted on the Nth call. */
const bodyOf = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

describe('TelegramApi', () => {
  const api = new TelegramApi('123:secret-token');

  beforeEach(() => fetchMock.mockReset());

  it('posts sendMessage with the inline keyboard in Telegram wire shape', async () => {
    fetchMock.mockReturnValue(ok({ message_id: 42, chat: { id: 1 } }));

    const message = await api.sendMessage('99', '<b>hi</b>', {
      parseMode: 'HTML',
      disablePreview: true,
      keyboard: [
        [
          { text: 'Start', callbackData: 'n:s:1' },
          { text: 'Open', url: 'https://example.test' },
        ],
      ],
    });

    expect(message.message_id).toBe(42);
    expect(bodyOf()).toEqual({
      chat_id: '99',
      text: '<b>hi</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Start', callback_data: 'n:s:1' },
            { text: 'Open', url: 'https://example.test' },
          ],
        ],
      },
    });
  });

  it('keeps the bot token in the URL and never in the body', async () => {
    fetchMock.mockReturnValue(ok({ message_id: 1, chat: { id: 1 } }));
    await api.sendMessage('99', 'hi');

    expect(fetchMock.mock.calls[0][0]).toContain('/bot123:secret-token/sendMessage');
    expect(fetchMock.mock.calls[0][1].body).not.toContain('secret-token');
  });

  it('omits an absent keyboard rather than sending an empty one', async () => {
    fetchMock.mockReturnValue(ok({ message_id: 1, chat: { id: 1 } }));
    await api.sendMessage('99', 'plain');
    expect(bodyOf()).toEqual({ chat_id: '99', text: 'plain' });
  });

  it('raises a typed error carrying the Telegram error code', async () => {
    fetchMock.mockReturnValue(fail({ error_code: 403, description: 'bot was blocked by the user' }, 403));

    await expect(api.sendMessage('99', 'hi')).rejects.toMatchObject({
      name: 'TelegramApiError',
      errorCode: 403,
    });
  });

  it('surfaces the retry_after hint on a rate limit', async () => {
    fetchMock.mockReturnValue(fail({ error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } }, 429));

    await expect(api.sendMessage('99', 'hi')).rejects.toMatchObject({ retryAfter: 7 });
  });

  it('turns a network failure into a plain error, not a TelegramApiError', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const error = await api.sendMessage('99', 'hi').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TelegramApiError);
    expect((error as Error).message).toContain('ECONNRESET');
  });

  it('names the cause of a network fault', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }));

    await expect(api.sendMessage('99', 'hi')).rejects.toThrow('sendMessage failed: fetch failed (ECONNRESET)');
  });

  it('retries an idempotent call once after a network fault', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockReturnValue(ok(true));

    await api.answerCallbackQuery('cb-1', 'ok');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(1)).toEqual({ callback_query_id: 'cb-1', text: 'ok' });
  });

  it('gives up after the second network fault', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(api.editMessageText('99', 1, 'x')).rejects.toThrow('editMessageText failed: fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never resends a message, which may have arrived', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(api.sendMessage('99', 'hi')).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a reply Telegram refused', async () => {
    fetchMock.mockReturnValue(fail({ error_code: 400, description: 'Bad Request: query is too old' }));

    await expect(api.answerCallbackQuery('cb-1')).rejects.toBeInstanceOf(TelegramApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('registers a webhook with the secret token and a narrow update filter', async () => {
    fetchMock.mockReturnValue(ok(true));
    await api.setWebhook('https://api.test/bot/telegram/webhook', 'shh');

    expect(bodyOf()).toEqual({
      url: 'https://api.test/bot/telegram/webhook',
      secret_token: 'shh',
      allowed_updates: ['message', 'callback_query'],
    });
  });
});

describe('TelegramApi.downloadFile', () => {
  const api = new TelegramApi('123:secret-token');
  const bytes = (n: number) =>
    Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(n)) } as Response);

  beforeEach(() => fetchMock.mockReset());

  it('resolves the file path with getFile, then reads the bytes from the file endpoint', async () => {
    fetchMock.mockReturnValueOnce(ok({ file_path: 'documents/cv.pdf', file_size: 10 })).mockReturnValueOnce(bytes(10));

    const file = await api.downloadFile('F1', 1000);

    expect(file.length).toBe(10);
    expect(bodyOf()).toEqual({ file_id: 'F1' });
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://api.telegram.org/file/bot123:secret-token/documents/cv.pdf',
    );
  });

  it('refuses a file over the cap before downloading it', async () => {
    fetchMock.mockReturnValueOnce(ok({ file_path: 'documents/big.pdf', file_size: 5000 }));
    await expect(api.downloadFile('F1', 1000)).rejects.toBeInstanceOf(TelegramApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a body larger than the cap when Telegram did not report the size', async () => {
    fetchMock.mockReturnValueOnce(ok({ file_path: 'documents/x.pdf' })).mockReturnValueOnce(bytes(2000));
    await expect(api.downloadFile('F1', 1000)).rejects.toBeInstanceOf(TelegramApiError);
  });
});

describe('escapeHtml', () => {
  it('escapes the characters Telegram treats as markup', () => {
    expect(escapeHtml('<b>A & B</b> "quoted"')).toBe(
      '&lt;b&gt;A &amp; B&lt;/b&gt; &quot;quoted&quot;',
    );
  });

  it('escapes the ampersand first, so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});
