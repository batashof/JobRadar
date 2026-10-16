import type { ApplicationItem } from '@jobradar/shared';

import {
  callbackData,
  daysWord,
  LIST_LIMIT,
  pairs,
  parseCallback,
  type RenderContext,
  renderCard,
  renderDeleteConfirm,
  renderList,
  renderReminder,
  renderSnoozed,
  stageButtons,
} from './applications-bot-logic';

const NOW = new Date('2026-10-16T12:00:00Z');
const ID = '11111111-2222-4333-8444-555555555555';
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function item(over: Partial<ApplicationItem> = {}, n = 1): ApplicationItem {
  return {
    id: ID.replace(/5$/, String(n % 10)),
    stage: 'applied',
    stageOrder: 0,
    notes: '',
    appliedAt: '2026-10-10T09:00:00Z',
    lastActivityAt: daysAgo(3),
    remindAfterDays: null,
    createdAt: '2026-10-10T09:00:00Z',
    vacancy: {
      id: 'vac-1',
      title: 'Senior Node.js Developer',
      company: 'Acme',
      url: 'https://acme.test/jobs/1',
      source: 'djinni',
    },
    ...over,
  };
}

const ru: RenderContext = { lang: 'ru', now: NOW, timezone: 'Europe/Moscow' };
const en: RenderContext = { lang: 'en', now: NOW, timezone: 'UTC' };

const allButtons = (keyboard: { text: string; callbackData?: string; url?: string }[][]) =>
  keyboard.flat();

describe('parseCallback', () => {
  it('reads list, archive and every per-application action', () => {
    expect(parseCallback(['j', 'l'])).toEqual({ kind: 'list', archived: false });
    expect(parseCallback(['j', 'a'])).toEqual({ kind: 'list', archived: true });
    expect(parseCallback(['j', 'o', ID])).toEqual({ kind: 'open', id: ID });
    expect(parseCallback(['j', 'd', ID])).toEqual({ kind: 'askDelete', id: ID });
    expect(parseCallback(['j', 'x', ID])).toEqual({ kind: 'delete', id: ID });
    expect(parseCallback(['j', 'z', ID])).toEqual({ kind: 'snooze', id: ID });
    expect(parseCallback(['j', 's', ID, 'i'])).toEqual({
      kind: 'stage',
      id: ID,
      stage: 'tech_interview',
    });
  });

  it('round-trips what the keyboards produce', () => {
    for (const data of [
      callbackData.list(),
      callbackData.list(true),
      callbackData.open(ID),
      callbackData.stage(ID, 'withdrawn'),
      callbackData.askDelete(ID),
      callbackData.delete(ID),
      callbackData.snooze(ID),
    ]) {
      expect(parseCallback(data.split(':'))).not.toBeNull();
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    }
  });

  it('refuses malformed and foreign data', () => {
    expect(parseCallback(['s', 'l'])).toBeNull();
    expect(parseCallback(['j'])).toBeNull();
    expect(parseCallback(['j', 'o'])).toBeNull();
    expect(parseCallback(['j', 'o', 'not-a-uuid'])).toBeNull();
    expect(parseCallback(['j', 's', ID, 'q'])).toBeNull();
    expect(parseCallback(['j', 's', ID])).toBeNull();
    expect(parseCallback(['j', 'q', ID])).toBeNull();
  });
});

describe('daysWord', () => {
  it('declines Russian and pluralises English', () => {
    expect(daysWord('ru', 1)).toBe('1 день');
    expect(daysWord('ru', 3)).toBe('3 дня');
    expect(daysWord('ru', 7)).toBe('7 дней');
    expect(daysWord('ru', 11)).toBe('11 дней');
    expect(daysWord('ru', 21)).toBe('21 день');
    expect(daysWord('ru', 22)).toBe('22 дня');
    expect(daysWord('en', 1)).toBe('1 day');
    expect(daysWord('en', 7)).toBe('7 days');
  });
});

describe('pairs', () => {
  it('never puts more than two buttons on a row', () => {
    const buttons = Array.from({ length: 5 }, (_, i) => ({ text: String(i) }));
    expect(pairs(buttons).map((row) => row.length)).toEqual([2, 2, 1]);
  });
});

describe('renderList', () => {
  it('explains the ✅ button when there is nothing yet', () => {
    const screen = renderList(ru, false, [], {});
    expect(screen.text).toContain('Откликов пока нет');
    expect(screen.text).toContain('«✅ Откликнулся»');
    expect(screen.keyboard).toEqual([]);
  });

  it('heads with per-stage counts and lists numbered lines with stage and age', () => {
    const items = [
      item({ stage: 'screening', lastActivityAt: daysAgo(2) }, 1),
      item({ vacancy: { ...item().vacancy, title: 'Go <Engineer>', company: 'B&Co' } }, 2),
    ];
    const screen = renderList(ru, false, items, { applied: 1, screening: 1, rejected: 2 });

    expect(screen.text).toContain('<b>📋 Твои отклики</b>');
    expect(screen.text).toContain('📨 Отклик: 1 · 📞 Скрининг: 1');
    expect(screen.text).not.toContain('Отказ: 2');
    expect(screen.text).toContain('1. <b>Senior Node.js Developer</b> — Acme');
    expect(screen.text).toContain('📞 Скрининг · 2 дня назад');
    // Source data is escaped.
    expect(screen.text).toContain('2. <b>Go &lt;Engineer&gt;</b> — B&amp;Co');
  });

  it('marks an application waiting past its threshold with ⏰', () => {
    const screen = renderList(en, false, [item({ lastActivityAt: daysAgo(8) })], { applied: 1 });
    expect(screen.text).toContain('📨 Applied · 8 days ago ⏰');
    const fresh = renderList(en, false, [item({ lastActivityAt: daysAgo(0) })], { applied: 1 });
    expect(fresh.text).toContain('📨 Applied · today');
    expect(fresh.text).not.toContain('⏰');
  });

  it('opens each application from a numbered button, two per row, plus the archive', () => {
    const items = [1, 2, 3].map((n) => item({}, n));
    const screen = renderList(en, false, items, { applied: 3, rejected: 1, withdrawn: 1 });

    expect(screen.keyboard.map((row) => row.length)).toEqual([2, 1, 1]);
    expect(screen.keyboard[0]![0]!).toEqual({
      text: '📄 1. Senior Node.js Developer',
      callbackData: callbackData.open(items[0]!.id),
    });
    expect(screen.keyboard[2]![0]).toEqual({ text: '🗄 Archive (2)', callbackData: 'j:a' });
    for (const button of allButtons(screen.keyboard)) expect(button.text).toMatch(/^\S+ /u);
  });

  it('cuts long titles on buttons and says how many are not shown', () => {
    const long = item({ vacancy: { ...item().vacancy, title: 'A'.repeat(60) } });
    const screen = renderList(en, false, [long], { applied: LIST_LIMIT + 5 });
    expect(screen.keyboard[0]![0]!.text.length).toBeLessThan(35);
    expect(screen.text).toContain(`The 1 most recently updated of ${LIST_LIMIT + 5}.`);
  });

  it('hides the archive button when the archive is empty', () => {
    const screen = renderList(en, false, [item()], { applied: 1 });
    expect(allButtons(screen.keyboard).some((b) => b.callbackData === 'j:a')).toBe(false);
  });

  it('lists the archive with a back button', () => {
    const screen = renderList(ru, true, [item({ stage: 'rejected' })], { rejected: 1, applied: 4 });
    expect(screen.text).toContain('🗄 Архив');
    expect(screen.text).toContain('❌ Отказ: 1');
    expect(screen.text).not.toContain('Отклик: 4');
    expect(screen.keyboard.at(-1)).toEqual([{ text: '⬅️ Назад', callbackData: 'j:l' }]);
  });

  it('says the archive is empty, still with the way back', () => {
    const screen = renderList(en, true, [], {});
    expect(screen.text).toContain('The archive is empty');
    expect(screen.keyboard).toEqual([[{ text: '⬅️ Back', callbackData: 'j:l' }]]);
  });
});

describe('renderCard', () => {
  it('shows the facts and a link to the posting', () => {
    const screen = renderCard(ru, item({ lastActivityAt: daysAgo(9) }));
    expect(screen.text).toContain('<b>Senior Node.js Developer</b>');
    expect(screen.text).toContain('Компания: Acme');
    expect(screen.text).toContain('Этап: 📨 Отклик');
    expect(screen.text).toContain('Отклик: 10 окт. 2026');
    expect(screen.text).toContain('9 дней назад · ⏰ пора напомнить о себе');
    expect(screen.text).toContain('<a href="https://acme.test/jobs/1">🔗 Открыть вакансию</a>');
  });

  it('offers every stage but the current one, with icons and words, two per row', () => {
    const screen = renderCard(en, item({ stage: 'screening' }));
    const stages = screen.keyboard.slice(0, -1);
    expect(stages.flat().map((b) => b.text)).toEqual([
      '📨 Applied',
      '💻 Interview',
      '🎉 Offer',
      '❌ Rejected',
      '🚫 Withdrawn',
    ]);
    expect(stages.every((row) => row.length <= 2)).toBe(true);
    expect(stages[0]![0]!.callbackData).toBe(callbackData.stage(item().id, 'applied'));
  });

  it('ends with delete and back; back returns to the archive for a closed one', () => {
    const active = renderCard(en, item());
    expect(active.keyboard.at(-1)).toEqual([
      { text: '🗑 Delete', callbackData: callbackData.askDelete(item().id) },
      { text: '⬅️ Back', callbackData: 'j:l' },
    ]);
    const closed = renderCard(en, item({ stage: 'withdrawn' }));
    expect(closed.keyboard.at(-1)?.[1]).toEqual({ text: '⬅️ Back', callbackData: 'j:a' });
  });

  it('leaves out the applied date and link when there are none', () => {
    const screen = renderCard(
      en,
      item({ stage: 'saved', appliedAt: null, vacancy: { ...item().vacancy, url: '' } }),
    );
    expect(screen.text).not.toContain('Applied:');
    expect(screen.text).not.toContain('<a href');
    expect(screen.keyboard.flat().map((b) => b.text)).toContain('📨 Applied');
  });
});

describe('renderDeleteConfirm', () => {
  it('asks before deleting, with a way out back to the card', () => {
    const screen = renderDeleteConfirm(en, item());
    expect(screen.text).toContain('Delete this application?');
    expect(screen.keyboard).toEqual([
      [
        { text: '🗑 Yes, delete', callbackData: callbackData.delete(item().id) },
        { text: '⬅️ No, keep it', callbackData: callbackData.open(item().id) },
      ],
    ]);
  });
});

describe('renderReminder', () => {
  const view = {
    id: ID,
    stage: 'applied' as const,
    title: 'Senior <Node>',
    company: 'Acme',
    days: 8,
    snoozeDays: 7,
  };

  it('names the company, the silence and the vacancy', () => {
    expect(renderReminder('en', view).text).toBe(
      '⏰ No answer from <b>Acme</b> for 8 days: Senior &lt;Node&gt;. Did anything change?',
    );
    expect(renderReminder('ru', view).text).toBe(
      '⏰ Нет ответа от <b>Acme</b> уже 8 дней: Senior &lt;Node&gt;. Что-нибудь изменилось?',
    );
  });

  it('carries the card stage buttons plus remind-later, two per row', () => {
    const { keyboard } = renderReminder('ru', view);
    const texts = keyboard.flat().map((b) => b.text);
    expect(texts).toEqual([
      ...stageButtons('ru', view).map((b) => b.text),
      '⏳ Напомнить через 7 дней',
    ]);
    expect(texts).not.toContain('📨 Отклик');
    expect(keyboard.every((row) => row.length <= 2)).toBe(true);
    expect(keyboard.flat().at(-1)?.callbackData).toBe(callbackData.snooze(ID));
  });
});

describe('renderSnoozed', () => {
  it('confirms when the next reminder comes and drops the buttons', () => {
    const screen = renderSnoozed('en', item(), 7);
    expect(screen.text).toContain('<b>Senior Node.js Developer</b> — Acme');
    expect(screen.text).toContain('remind you again in 7 days');
    expect(screen.keyboard).toEqual([]);
  });
});
