import { describeUpdate, parseUpdate } from './bot-update';

const privateChat = { id: 12345, type: 'private' };

describe('parseUpdate', () => {
  it('parses a bare command', () => {
    expect(parseUpdate({ message: { text: '/help', chat: privateChat } })).toEqual({
      type: 'command',
      chatId: '12345',
      username: null,
      fromId: null,
      languageCode: null,
      command: 'help',
      argument: '',
    });
  });

  it('parses /start with its deep-link token and the sender username', () => {
    expect(
      parseUpdate({
        message: {
          text: '/start abc_TOKEN-123',
          chat: privateChat,
          from: { id: 12345, username: 'vlad', language_code: 'en-US' },
        },
      }),
    ).toEqual({
      type: 'command',
      chatId: '12345',
      username: 'vlad',
      fromId: '12345',
      languageCode: 'en-US',
      command: 'start',
      argument: 'abc_TOKEN-123',
    });
  });

  it('strips the @botname suffix and lower-cases the command', () => {
    const parsed = parseUpdate({ message: { text: '/START@JobRadarBot tok', chat: privateChat } });
    expect(parsed).toMatchObject({ command: 'start', argument: 'tok' });
  });

  it('parses plain text as an answer to a possible dialog', () => {
    expect(
      parseUpdate({ message: { text: '  React, TypeScript ', chat: privateChat, from: { id: 9 } } }),
    ).toEqual({ type: 'text', chatId: '12345', fromId: '9', languageCode: null, text: 'React, TypeScript' });
  });

  it('parses a document with its file id, name, type and size', () => {
    expect(
      parseUpdate({
        message: {
          chat: privateChat,
          from: { id: 9, language_code: 'ru' },
          document: { file_id: 'F1', file_name: 'cv.pdf', mime_type: 'application/pdf', file_size: 1234 },
        },
      }),
    ).toEqual({
      type: 'document',
      chatId: '12345',
      fromId: '9',
      languageCode: 'ru',
      fileId: 'F1',
      fileName: 'cv.pdf',
      mimeType: 'application/pdf',
      fileSize: 1234,
    });
  });

  it('ignores group chats and empty messages', () => {
    expect(parseUpdate({ message: { text: '/start', chat: { id: 1, type: 'group' } } })).toBeNull();
    expect(parseUpdate({ message: { text: 'hello', chat: { id: 1, type: 'group' } } })).toBeNull();
    expect(parseUpdate({ message: { chat: privateChat } })).toBeNull();
    expect(parseUpdate({})).toBeNull();
    // A lone slash is not a command.
    expect(parseUpdate({ message: { text: '/', chat: privateChat } })).toBeNull();
  });

  it('parses a callback query and splits its data', () => {
    expect(
      parseUpdate({
        callback_query: {
          id: 'cb-1',
          data: 'n:a:11111111-2222-3333-4444-555555555555',
          message: { message_id: 77, chat: { id: 12345 } },
        },
      }),
    ).toEqual({
      type: 'callback',
      callbackId: 'cb-1',
      chatId: '12345',
      messageId: 77,
      data: 'n:a:11111111-2222-3333-4444-555555555555',
      parts: ['n', 'a', '11111111-2222-3333-4444-555555555555'],
    });
  });

  it('drops a callback whose originating message is gone', () => {
    expect(parseUpdate({ callback_query: { id: 'cb-1', data: 'n:a:x' } })).toBeNull();
  });

  it('prefers the callback over a message when an update somehow carries both', () => {
    const parsed = parseUpdate({
      message: { text: '/help', chat: privateChat },
      callback_query: { id: 'cb-1', data: 'd:x:1', message: { message_id: 1, chat: { id: 9 } } },
    });
    expect(parsed).toMatchObject({ type: 'callback' });
  });
});

describe('describeUpdate (v2.6.0)', () => {
  const chat = { id: 1, type: 'private' };

  it('labels commands and buttons, never the typed text or file name', () => {
    const label = (update: Parameters<typeof parseUpdate>[0]) => describeUpdate(parseUpdate(update)!);
    expect(label({ message: { text: '/resume now', chat } })).toBe('/resume');
    expect(
      label({ callback_query: { id: 'c', data: 's:loc:3:x', message: { message_id: 1, chat: { id: 1 } } } }),
    ).toBe('button s:loc');
    expect(label({ message: { text: 'my secret salary', chat } })).toBe('typed text');
    expect(label({ message: { document: { file_id: 'f', file_name: 'Ivan_CV.pdf' }, chat } })).toBe('file');
  });
});
