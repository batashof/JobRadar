import {
  compactTimes,
  decide,
  normalizeTimezone,
  parseTyped,
  LOCATIONS_MAX,
  renderScreen,
  SCREENS,
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
  locations: [],
  timezone: 'Europe/Moscow',
  language: 'ru',
  profile: null,
  ...over,
});

const PROFILE = {
  role: 'Frontend Developer',
  grade: 'senior',
  skills: [
    { name: 'React', weight: 'core' as const },
    { name: 'GraphQL', weight: 'familiar' as const },
    { name: 'TypeScript', weight: 'core' as const },
  ],
  confirmed: true,
};

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

  it('returns to the filters after a filter is picked', () => {
    expect(decide(state(), ['s', 'ms', '80'], SLUGS).screen).toBe('flt');
    expect(decide(state(), ['s', 'sal', '2500'], SLUGS).screen).toBe('flt');
    expect(decide(state(), ['s', 'cap', '5'], SLUGS).screen).toBe('main');
  });

  it('edits the resume profile from the filters', () => {
    const s = state({ profile: PROFILE });
    expect(decide(s, ['s', 'role', 'backend'], SLUGS)).toEqual({
      profilePatch: { role: 'Backend Developer' },
      screen: 'flt',
    });
    expect(decide(s, ['s', 'grade', 'middle'], SLUGS)).toEqual({ profilePatch: { grade: 'middle' }, screen: 'flt' });
    expect(decide(s, ['s', 'grade', 'wizard'], SLUGS)).toEqual({ screen: 'grade' });
    expect(decide(s, ['s', 'role', 'nonsense'], SLUGS)).toEqual({ screen: 'role' });
    expect(decide(s, ['s', 'type', 'sk'], SLUGS)).toEqual({ screen: 'flt', typeStep: 'sk' });
    // No profile yet: nothing to edit, back to the filters (which ask for the resume).
    expect(decide(state(), ['s', 'grade', 'middle'], SLUGS)).toEqual({ screen: 'flt' });
    expect(decide(state(), ['s', 'type', 'sk'], SLUGS)).toEqual({ screen: 'flt' });
  });

  it('removes one wanted place, or all of them', () => {
    const s = state({ locations: ['Минск', 'Польша', 'Тбилиси'] });
    expect(decide(s, ['s', 'loc', '1'], SLUGS)).toEqual({ patch: { locations: ['Минск', 'Тбилиси'] }, screen: 'loc' });
    expect(decide(s, ['s', 'loc', 'clear'], SLUGS)).toEqual({ patch: { locations: [] }, screen: 'loc' });
    expect(decide(s, ['s', 'loc', '7'], SLUGS)).toEqual({ screen: 'loc' });
    expect(decide(s, ['s', 'type', 'loc'], SLUGS)).toEqual({ screen: 'loc', typeStep: 'loc' });
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

  it('adds typed places to the list, without duplicates and up to the cap', () => {
    expect(parseTyped('loc', 'MINSK, Poland;  Tbilisi ', { locations: ['minsk'] })).toEqual({
      locations: ['minsk', 'Poland', 'Tbilisi'],
    });
    expect(parseTyped('loc', ' , ;')).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => `City${i}`).join(', ');
    expect(parseTyped('loc', many)?.locations).toHaveLength(LOCATIONS_MAX);
  });

  it('reads a salary and rejects nonsense', () => {
    expect(parseTyped('sal', '$3 000')).toEqual({ minSalaryUsd: 3000 });
    expect(parseTyped('sal', '0')).toEqual({ minSalaryUsd: null });
    expect(parseTyped('sal', 'a lot')).toBeNull();
    expect(parseTyped('sal', '120000')).toBeNull();
  });
});

describe('renderScreen', () => {
  it('keeps "when" on the settings screen and points to /filters for "which"', () => {
    const { text, keyboard } = renderScreen(
      'main',
      state({ workFormats: ['remote'], minSalaryUsd: 3000, mutedSources: ['hh'] }),
      SLUGS,
    );
    expect(text).toContain('Настройки</b>: когда присылать');
    expect(text).toContain('Доставка: сразу после публикации, тишина 22:00–08:00');
    expect(text).toContain('/filters');
    expect(text).not.toContain('Формат');
    expect(text).not.toContain('Минимальное совпадение');
    expect(data(keyboard)).toEqual(
      expect.arrayContaining(['s:mode', 's:open:t', 's:open:tz', 's:pause', 's:lang', 's:open:flt', 'p:res']),
    );
    for (const gone of ['s:open:ms', 's:open:fmt', 's:open:emp', 's:open:sal', 's:open:src', 'p:setup']) {
      expect(data(keyboard)).not.toContain(gone);
    }
  });

  it('shows the hard filters and the resume profile on the filters screen', () => {
    const { text, keyboard } = renderScreen(
      'flt',
      state({ workFormats: ['remote'], minSalaryUsd: 3000, mutedSources: ['hh'], profile: PROFILE }),
      SLUGS,
    );
    expect(text).toContain('Фильтры</b>: какие вакансии присылать');
    expect(text).toContain('Роль: Frontend Developer');
    expect(text).toContain('Грейд: Senior');
    // Main skills first.
    expect(text).toContain('Навыки: React, TypeScript, GraphQL');
    expect(text).toContain('Минимальное совпадение: 75%');
    expect(text).toContain('Формат: Удалённо');
    expect(text).toContain('Локация: любая');
    expect(text).toContain('$3000/мес');
    expect(text).toContain('Выключенные источники: hh');
    expect(text).not.toContain('не подтверждён');
    expect(data(keyboard)).toEqual(
      expect.arrayContaining([
        's:open:role', 's:open:grade', 's:type:sk', 's:open:ms', 's:open:fmt', 's:open:emp', 's:open:sal',
        's:open:src', 's:open:loc', 's:menu',
      ]),
    );
  });

  it('lists the wanted places as buttons that remove them', () => {
    const { text, keyboard } = renderScreen('loc', state({ locations: ['Минск', 'Польша'] }), SLUGS);
    expect(text).toContain('Удалённые');
    expect(keyboard[0]).toEqual([
      { text: '✖️ Минск', callbackData: 's:loc:0' },
      { text: '✖️ Польша', callbackData: 's:loc:1' },
    ]);
    expect(data(keyboard)).toEqual(expect.arrayContaining(['s:type:loc', 's:loc:clear', 's:open:flt']));
    expect(renderScreen('flt', state({ locations: ['Минск', 'Польша'] }), SLUGS).text).toContain(
      'Локация: Минск, Польша',
    );
    // Nothing to clear on an empty list.
    expect(data(renderScreen('loc', state(), SLUGS).keyboard)).not.toContain('s:loc:clear');
  });

  it('asks for the resume on the filters screen when there is no profile yet', () => {
    const { text, keyboard } = renderScreen('flt', state(), SLUGS);
    expect(text).toContain('пришли его файлом PDF');
    expect(data(keyboard)).toContain('p:res');
    expect(data(keyboard)).not.toContain('s:open:role');
  });

  it('says an unconfirmed profile sends nothing yet', () => {
    const { text } = renderScreen('flt', state({ profile: { ...PROFILE, confirmed: false } }), SLUGS);
    expect(text).toContain('Профиль ещё не подтверждён');
  });

  it('leads back from a filter screen to the filters, from a delivery screen to the settings', () => {
    for (const screen of ['fmt', 'emp', 'src', 'ms', 'sal', 'role', 'grade', 'loc'] as const) {
      expect(renderScreen(screen, state({ profile: PROFILE }), SLUGS).keyboard.at(-1)).toEqual([
        { text: '← Назад', callbackData: 's:open:flt' },
      ]);
    }
    for (const screen of ['cap', 't', 'q', 'tz'] as const) {
      expect(renderScreen(screen, state(), SLUGS).keyboard.at(-1)?.[0]?.callbackData).toBe('s:menu');
    }
    expect(data(renderScreen('flt', state(), SLUGS, 'sk').keyboard)).toEqual(['s:open:flt']);
    expect(data(renderScreen('sal', state(), SLUGS, 'sal').keyboard)).toEqual(['s:open:flt']);
    expect(data(renderScreen('loc', state(), SLUGS, 'loc').keyboard)).toEqual(['s:open:loc']);
  });

  it('marks the current role and grade in their pickers', () => {
    const s = state({ profile: PROFILE });
    expect(renderScreen('grade', s, SLUGS).keyboard.flat().find((b) => b.callbackData === 's:grade:senior')?.text).toBe(
      '✅ Senior',
    );
    expect(data(renderScreen('role', s, SLUGS).keyboard)).toContain('s:role:frontend');
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
    for (const screen of SCREENS) {
      const { keyboard } = renderScreen(screen, { ...s, profile: PROFILE }, SLUGS);
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
