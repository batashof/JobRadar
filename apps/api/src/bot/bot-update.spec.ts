import { parseUpdate } from './bot-update';

const privateChat = { id: 12345, type: 'private' };

describe('parseUpdate', () => {
  it('parses a bare command', () => {
    expect(parseUpdate({ message: { text: '/help', chat: privateChat } })).toEqual({
      type: 'command',
      chatId: '12345',
      username: null,
      command: 'help',
      argument: '',
    });
  });

  it('parses /start with its deep-link token and the sender username', () => {
    expect(
      parseUpdate({
        message: { text: '/start abc_TOKEN-123', chat: privateChat, from: { username: 'vlad' } },
      }),
    ).toEqual({
      type: 'command',
      chatId: '12345',
      username: 'vlad',
      command: 'start',
      argument: 'abc_TOKEN-123',
    });
  });

  it('strips the @botname suffix and lower-cases the command', () => {
    const parsed = parseUpdate({ message: { text: '/START@JobRadarBot tok', chat: privateChat } });
    expect(parsed).toMatchObject({ command: 'start', argument: 'tok' });
  });

  it('ignores group chats, plain text and non-command messages', () => {
    expect(parseUpdate({ message: { text: '/start', chat: { id: 1, type: 'group' } } })).toBeNull();
    expect(parseUpdate({ message: { text: 'hello there', chat: privateChat } })).toBeNull();
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
