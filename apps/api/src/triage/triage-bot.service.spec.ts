import type { BotCallbackContext, BotMessageContext } from '../bot/bot.service';
import { loadTriage, markDigested, setReportStatus } from './reports';
import { TriageBotService } from './triage-bot.service';
import type { TriageItem } from './triage-logic';

jest.mock('./reports', () => ({
  loadTriage: jest.fn(),
  markDigested: jest.fn(),
  setReportStatus: jest.fn(),
}));

const item: TriageItem = {
  id: 7,
  kind: 'feedback',
  title: 'нет Go',
  detail: 'нет вакансий по Go',
  count: 1,
  transient: false,
  status: 'new',
  unseen: true,
};

const owner: BotMessageContext = { userId: 'o1', chatId: '42', language: 'ru', role: 'owner' };
const press = (parts: string[], role: 'owner' | 'user' = 'owner'): BotCallbackContext => ({
  userId: 'o1',
  chatId: '42',
  messageId: 5,
  parts,
  language: 'ru',
  role,
});

function setup() {
  const bot = {
    registerCommand: jest.fn(),
    registerCallback: jest.fn(),
    sendToUser: jest.fn().mockResolvedValue('100'),
  };
  const service = new TriageBotService({} as never, bot as never);
  jest.mocked(loadTriage).mockResolvedValue({ items: [item], extras: { quietTransient: 0, inProgress: 0 } });
  jest.mocked(setReportStatus).mockResolvedValue(true);
  jest.mocked(markDigested).mockResolvedValue();
  return { service, bot };
}

describe('TriageBotService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registers /triage and the t namespace', () => {
    const { service, bot } = setup();
    service.onModuleInit();
    expect(bot.registerCommand).toHaveBeenCalledWith('triage', expect.any(Function));
    expect(bot.registerCallback).toHaveBeenCalledWith('t', expect.any(Function));
  });

  it('shows the list to the owner and counts it as seen', async () => {
    const { service, bot } = setup();
    await service.show(owner);
    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('нет вакансий по Go');
    expect(options.keyboard[0][0]).toEqual({ text: '🛠 #7', callbackData: 't:f:7' });
    expect(markDigested).toHaveBeenCalledWith({}, [7]);
  });

  it('refuses everyone else', async () => {
    const { service, bot } = setup();
    await service.show({ ...owner, role: 'user' });
    expect(bot.sendToUser).toHaveBeenCalledWith('o1', 'Доступно только автору.');
    expect(loadTriage).not.toHaveBeenCalled();
    expect(await service.press(press(['t', 'f', '7'], 'user'))).toEqual({ alert: 'Доступно только автору.' });
    expect(setReportStatus).not.toHaveBeenCalled();
  });

  it('marks an item to fix and redraws the list', async () => {
    const { service } = setup();
    jest.mocked(loadTriage).mockResolvedValue({
      items: [{ ...item, status: 'fix' }],
      extras: { quietTransient: 0, inProgress: 0 },
    });
    const result = await service.press(press(['t', 'f', '7']));
    expect(setReportStatus).toHaveBeenCalledWith({}, 7, 'fix');
    expect(result.alert).toBe('#7: в работу');
    expect(result.editText).toContain('<i>в работу</i>');
    expect(result.editKeyboard?.[0]?.[0]).toEqual({ text: '↩️ #7', callbackData: 't:n:7' });
  });

  it.each([
    ['s', 'skip', '#7: пропущено'],
    ['n', 'new', '#7: снова в списке'],
  ])('action %s sets %s', async (action, status, alert) => {
    const { service } = setup();
    const result = await service.press(press(['t', action, '7']));
    expect(setReportStatus).toHaveBeenCalledWith({}, 7, status);
    expect(result.alert).toBe(alert);
  });

  it('says when GitHub already owns the item', async () => {
    const { service } = setup();
    jest.mocked(setReportStatus).mockResolvedValue(false);
    const result = await service.press(press(['t', 'f', '7']));
    expect(result.alert).toBe('#7 уже у фиксера или закрыт.');
  });

  it('ignores a malformed press', async () => {
    const { service } = setup();
    expect(await service.press(press(['t', 'x', '7']))).toEqual({});
    expect(await service.press(press(['t', 'f', 'abc']))).toEqual({});
    expect(setReportStatus).not.toHaveBeenCalled();
  });
});
