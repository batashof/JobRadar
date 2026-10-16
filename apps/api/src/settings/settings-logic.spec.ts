import {
  compactTimes,
  decide,
  normalizeTimezone,
  parseTyped,
  renderScreen,
  type SettingsState,
  TIMEZONE_PRESETS,
} from './settings-logic';

const state = (over: Partial<SettingsState> = {}): SettingsState => ({
  enabled: true,
  mode: 'instant',
  sendTimes: ['09:00'],
  quietStart: '22:00',
  quietEnd: '08:00',
  minScore: 60,
  instantMinScore: 75,
  maxItems: null,
  workFormats: [],
  employmentTypes: [],
  minSalaryUsd: null,
  mutedSources: [],
  timezone: 'Europe/Moscow',
  language: 'ru',
  ...over,
});

const SLUGS = ['hh', 'remoteok', 'telegram'];

/** Every callback_data of a keyboard. */
const data = (keyboard: { callbackData?: string }[][]) =>
  keyboard.flat().map((b) => b.callbackData ?? '');

describe('decide', () => {
  it('flips the two-way settings', () => {
    expect(decide(state(), ['s', 'mode'], SLUGS).patch).toEqual({ mode: 'scheduled' });
    expect(decide(state({ mode: 'scheduled' }), ['s', 'mode'], SLUGS).patch).toEqual({ mode: 'instant' });
    expect(decide(state(), ['s', 'pause'], SLUGS).patch).toEqual({ enabled: false });
    expect(decide(state(), ['s', 'lang'], SLUGS).patch).toEqual({ language: 'en' });
  });

  it('toggles list entries and stays on the list screen', () => {
    const on = decide(state(), ['s', 'fmt', 'remote'], SLUGS);
    expect(on).toEqual({ patch: { workFormats: ['remote'] }, screen: 'fmt' });
    const off = decide(state({ workFormats: ['remote', 'hybrid'] }), ['s', 'fmt', 'remote'], SLUGS);
    expect(off.patch).toEqual({ workFormats: ['hybrid'] });
    expect(decide(state(), ['s', 'emp', 'freelance'], SLUGS).patch).toEqual({
      employmentTypes: ['freelance'],
    });
    expect(decide(state(), ['s', 'src', 'hh'], SLUGS).patch).toEqual({ mutedSources: ['hh'] });
  });

  it('ignores values outside the closed lists', () => {
    expect(decide(state(), ['s', 'fmt', 'mars'], SLUGS).patch).toBeUndefined();
    expect(decide(state(), ['s', 'src', 'linkedin'], SLUGS).patch).toBeUndefined();
    expect(decide(state(), ['s', 'cap', '7'], SLUGS).patch).toBeUndefined();
    expect(decide(state(), ['s', 'tz', '99'], SLUGS).patch).toBeUndefined();
    expect(decide(state(), ['s', 'nonsense'], SLUGS)).toEqual({ screen: 'main' });
  });

  it('sets the floor of the mode in use', () => {
    expect(decide(state(), ['s', 'ms', '80'], SLUGS).patch).toEqual({ instantMinScore: 80 });
    expect(decide(state({ mode: 'scheduled' }), ['s', 'ms', '50'], SLUGS).patch).toEqual({ minScore: 50 });
  });

  it('maps zero to "none" for cap and salary', () => {
    expect(decide(state({ maxItems: 10 }), ['s', 'cap', '0'], SLUGS).patch).toEqual({ maxItems: null });
    expect(decide(state(), ['s', 'cap', '20'], SLUGS).patch).toEqual({ maxItems: 20 });
    expect(decide(state(), ['s', 'sal', '0'], SLUGS).patch).toEqual({ minSalaryUsd: null });
    expect(decide(state(), ['s', 'sal', '2500'], SLUGS).patch).toEqual({ minSalaryUsd: 2500 });
  });

  it('applies time presets, switching to scheduled delivery', () => {
    expect(decide(state(), ['s', 't', '1000-1800'], SLUGS).patch).toEqual({
      sendTimes: ['10:00', '18:00'],
      mode: 'scheduled',
    });
    expect(decide(state(), ['s', 'q', '2300-0700'], SLUGS).patch).toEqual({
      quietStart: '23:00',
      quietEnd: '07:00',
    });
    expect(decide(state(), ['s', 'tz', '6'], SLUGS).patch).toEqual({ timezone: TIMEZONE_PRESETS[6] });
  });

  it('asks for a typed value', () => {
    expect(decide(state(), ['s', 'type', 'tz'], SLUGS)).toEqual({ screen: 'tz', typeStep: 'tz' });
    expect(decide(state(), ['s', 'type', 'evil'], SLUGS)).toEqual({ screen: 'main' });
  });
});

describe('parseTyped', () => {
  it('reads send times, sorted and de-duplicated', () => {
    expect(parseTyped('t', '18:00, 9.30 18:00')).toEqual({
      sendTimes: ['09:30', '18:00'],
      mode: 'scheduled',
    });
    expect(parseTyped('t', '25:00')).toBeNull();
    expect(parseTyped('t', '1:00, 2:00, 3:00, 4:00, 5:00')).toBeNull();
  });

  it('reads a quiet window with any dash', () => {
    expect(parseTyped('q', '23:00–07:00')).toEqual({ quietStart: '23:00', quietEnd: '07:00' });
    expect(parseTyped('q', '23:00')).toBeNull();
  });

  it('accepts only zones the runtime knows', () => {
    expect(parseTyped('tz', 'Europe/Lisbon')).toEqual({ timezone: 'Europe/Lisbon' });
    expect(parseTyped('tz', 'Mars/Olympus')).toBeNull();
    expect(normalizeTimezone('')).toBeNull();
  });

  it('reads a salary and rejects nonsense', () => {
    expect(parseTyped('sal', '$3 000')).toEqual({ minSalaryUsd: 3000 });
    expect(parseTyped('sal', '0')).toEqual({ minSalaryUsd: null });
    expect(parseTyped('sal', 'a lot')).toBeNull();
    expect(parseTyped('sal', '120000')).toBeNull();
  });
});

describe('renderScreen', () => {
  it('summarises everything on the main screen', () => {
    const { text, keyboard } = renderScreen(
      'main',
      state({ workFormats: ['remote'], minSalaryUsd: 3000, mutedSources: ['hh'] }),
      SLUGS,
    );
    expect(text).toContain('Доставка: сразу после публикации, тишина 22:00–08:00');
    expect(text).toContain('Минимальное совпадение: 75%');
    expect(text).toContain('Формат: Удалённо');
    expect(text).toContain('$3000/мес');
    expect(text).toContain('Выключенные источники: hh');
    expect(data(keyboard)).toEqual(
      expect.arrayContaining(['s:mode', 's:open:t', 's:open:tz', 's:pause', 's:lang', 's:open:src']),
    );
  });

  it('shows scheduled times and the paused state in English', () => {
    const { text, keyboard } = renderScreen(
      'main',
      state({ mode: 'scheduled', sendTimes: ['09:00', '18:00'], enabled: false, language: 'en' }),
      SLUGS,
    );
    expect(text).toContain('Delivery: at 09:00, 18:00');
    expect(text).toContain('Status: paused');
    expect(keyboard.flat().some((b) => b.text === '▶️ Resume')).toBe(true);
    // Buttons name the setting and show its current value.
    expect(keyboard.flat().find((b) => b.callbackData === 's:lang')?.text).toBe('🌐 Language: English');
    expect(keyboard.flat().find((b) => b.callbackData === 's:mode')?.text).toBe('📬 Delivery: scheduled');
  });

  it('lays the main menu out two buttons per row, each with an icon', () => {
    const { keyboard } = renderScreen('main', state(), SLUGS);
    expect(keyboard.every((row) => row.length <= 2)).toBe(true);
    for (const b of keyboard.flat()) expect(b.text).toMatch(/^\p{Extended_Pictographic}/u);
    expect(keyboard.flat().find((b) => b.callbackData === 's:lang')?.text).toBe('🌐 Язык: Русский');
    expect(keyboard.flat().find((b) => b.callbackData === 's:mode')?.text).toBe('📬 Доставка: сразу');
  });

  it('ends the main menu with a full-width "send now" button for the digest module', () => {
    const { keyboard } = renderScreen('main', state(), SLUGS);
    expect(keyboard.at(-1)).toEqual([{ text: '📥 Прислать вакансии сейчас', callbackData: 'd:n' }]);
    const en = renderScreen('main', state({ language: 'en' }), SLUGS).keyboard;
    expect(en.at(-1)?.[0]?.text).toBe('📥 Send vacancies now');
  });

  it('marks the selected options and keeps every callback within 64 bytes', () => {
    const s = state({ workFormats: ['hybrid'], mutedSources: ['telegram'] });
    for (const screen of ['main', 'fmt', 'emp', 'src', 'ms', 'cap', 'sal', 't', 'q', 'tz'] as const) {
      const { keyboard } = renderScreen(screen, s, SLUGS);
      for (const value of data(keyboard)) expect(Buffer.byteLength(value)).toBeLessThanOrEqual(64);
    }
    expect(renderScreen('fmt', s, SLUGS).keyboard[0]?.find((b) => b.callbackData === 's:fmt:hybrid')?.text).toBe(
      '✅ Гибрид',
    );
    expect(data(renderScreen('src', s, SLUGS).keyboard)).toContain('s:src:telegram');
  });

  it('asks for the typed value with a way back', () => {
    const { text, keyboard } = renderScreen('tz', state(), SLUGS, 'tz');
    expect(text).toContain('Europe/Lisbon');
    expect(data(keyboard)).toEqual(['s:menu']);
  });

  it('round-trips compact times', () => {
    expect(compactTimes(['09:00', '18:30'])).toBe('0900-1830');
  });
});
