import type { searchProfiles, sources, users } from './schema';

type SourceSeed = Pick<typeof sources.$inferInsert, 'slug' | 'kind' | 'isActive' | 'config'>;

/** Source registry per docs/DATA_SOURCES.md. Config shapes are consumed by ingestion workers. */
export const SEED_SOURCES: SourceSeed[] = [
  {
    slug: 'hh',
    kind: 'api',
    isActive: true,
    config: { baseUrl: 'https://api.hh.ru', endpoint: '/vacancies' },
  },
  {
    slug: 'remoteok',
    kind: 'api',
    isActive: true,
    // API terms require linking back to the original posting.
    config: { feedUrl: 'https://remoteok.com/api', linkBackRequired: true },
  },
  {
    // v1.0 uses RemoteOK; WWR stays registered but inactive (DATA_SOURCES.md: pick one).
    slug: 'weworkremotely',
    kind: 'rss',
    isActive: false,
    config: { feedUrl: 'https://weworkremotely.com/categories/remote-programming-jobs.rss' },
  },
];

/** Local-development-only fixtures (never seeded in production). */
export const DEV_USER: Pick<typeof users.$inferInsert, 'email'> = {
  email: 'dev@jobradar.local',
};

export const DEV_PROFILE: Omit<typeof searchProfiles.$inferInsert, 'userId'> = {
  name: 'Senior React remote',
  keywords: ['react', 'frontend', 'typescript'],
  stack: ['react', 'typescript', 'next.js'],
  workFormat: ['remote'],
  employmentType: ['full_time'],
  salaryCurrency: 'USD',
};
