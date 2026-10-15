import { DEFAULT_SOURCE_INTERVAL_MS, isSourceDue, sourceIntervalMs } from './schedule';

const MIN = 60 * 1000;
const now = new Date('2026-10-15T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN);

describe('sourceIntervalMs', () => {
  it('polls Telegram and LinkedIn alerts every 10 minutes, ATS and WWR hourly', () => {
    expect(sourceIntervalMs('telegram')).toBe(10 * MIN);
    expect(sourceIntervalMs('linkedin')).toBe(10 * MIN);
    expect(sourceIntervalMs('ats')).toBe(60 * MIN);
    expect(sourceIntervalMs('weworkremotely')).toBe(60 * MIN);
  });

  it('keeps every other source on 4 hours', () => {
    for (const slug of ['remoteok', 'remotive', 'jobicy', 'himalayas', 'hn', 'workingnomads']) {
      expect(sourceIntervalMs(slug)).toBe(DEFAULT_SOURCE_INTERVAL_MS);
    }
    expect(DEFAULT_SOURCE_INTERVAL_MS).toBe(240 * MIN);
  });
});

describe('isSourceDue', () => {
  const state = (slug: string, minutesAgo: number | null, status: string | null = 'ok') => ({
    slug,
    lastRunAt: minutesAgo === null ? null : ago(minutesAgo),
    lastRunStatus: status,
  });

  it('runs a source that never ran', () => {
    expect(isSourceDue(state('remoteok', null, null), now)).toBe(true);
  });

  it('runs a 10-minute source on the next tick even when its last run ended a minute late', () => {
    expect(isSourceDue(state('telegram', 9), now)).toBe(true);
  });

  it('skips a 10-minute source that ran moments ago (duplicate trigger)', () => {
    expect(isSourceDue(state('telegram', 2), now)).toBe(false);
  });

  it('keeps 4-hour sources at 4 hours', () => {
    expect(isSourceDue(state('remotive', 120), now)).toBe(false);
    expect(isSourceDue(state('remotive', 239), now)).toBe(true);
  });

  it('retries a failed slow source after an hour, not on every tick', () => {
    expect(isSourceDue(state('remotive', 30, 'error'), now)).toBe(false);
    expect(isSourceDue(state('remotive', 60, 'error'), now)).toBe(true);
    expect(isSourceDue(state('himalayas', 60, 'empty'), now)).toBe(true);
  });

  it('never retries a failed fast source sooner than its own interval', () => {
    expect(isSourceDue(state('telegram', 3, 'error'), now)).toBe(false);
  });

  it('force always runs', () => {
    expect(isSourceDue(state('remotive', 1), now, true)).toBe(true);
  });
});
