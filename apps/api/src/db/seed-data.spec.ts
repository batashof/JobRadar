import { sourceKindEnum } from './schema';
import { DEV_PROFILE, SEED_SOURCES } from './seed-data';

describe('seed data', () => {
  it('has unique source slugs', () => {
    const slugs = SEED_SOURCES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('registers the v1.0 sources as active (telegram primary, hh dropped per ADR-009)', () => {
    const active = SEED_SOURCES.filter((s) => s.isActive).map((s) => s.slug);
    expect(active).toEqual(['telegram', 'remoteok', 'weworkremotely']);
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
