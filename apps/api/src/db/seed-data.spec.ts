import { sourceKindEnum } from './schema';
import { DEV_PROFILE, SEED_SOURCES } from './seed-data';

describe('seed data', () => {
  it('has unique source slugs', () => {
    const slugs = SEED_SOURCES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('registers the active sources (telegram primary, hh and remoteok dropped)', () => {
    const active = SEED_SOURCES.filter((s) => s.isActive).map((s) => s.slug);
    expect(active).toEqual([
      'telegram',
      'weworkremotely',
      'remotive',
      'jobicy',
      'hn',
      'himalayas',
      'workingnomads',
    ]);
  });

  it('keeps hh (ADR-009) and remoteok (ADR-016) registered but inactive', () => {
    const inactive = SEED_SOURCES.filter((s) => !s.isActive).map((s) => s.slug);
    expect(inactive).toEqual(['hh', 'remoteok']);
  });

  it('points multi-feed sources at unique feed URLs', () => {
    for (const source of SEED_SOURCES) {
      const feedUrls = (source.config as { feedUrls?: string[] } | undefined)?.feedUrls;
      if (!feedUrls) continue;
      expect(feedUrls.length).toBeGreaterThan(0);
      expect(new Set(feedUrls).size).toBe(feedUrls.length);
    }
  });

  it('configures telegram channels as clean, unique usernames without @', () => {
    const telegram = SEED_SOURCES.find((s) => s.slug === 'telegram');
    const channels = (telegram?.config as { channels?: string[] } | undefined)?.channels ?? [];
    expect(channels.length).toBeGreaterThan(0);
    expect(new Set(channels).size).toBe(channels.length);
    for (const channel of channels) {
      expect(channel).not.toContain('@');
      expect(channel).toMatch(/^[a-z0-9_]+$/i);
    }
  });

  it('uses only valid source kinds', () => {
    for (const source of SEED_SOURCES) {
      expect(sourceKindEnum.enumValues).toContain(source.kind);
    }
  });

  it('dev profile targets remote work', () => {
    expect(DEV_PROFILE.workFormat).toEqual(['remote']);
    expect(DEV_PROFILE.keywords?.length).toBeGreaterThan(0);
  });
});
