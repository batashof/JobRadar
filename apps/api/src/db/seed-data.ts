import type { searchProfiles, sources, users } from './schema';

type SourceSeed = Pick<typeof sources.$inferInsert, 'slug' | 'kind' | 'isActive' | 'config'>;

/** Source registry per docs/DATA_SOURCES.md. Config shapes are consumed by ingestion workers. */
export const SEED_SOURCES: SourceSeed[] = [
  {
    // Inactive until HH_API_TOKEN is available: hh geo-403s anonymous requests
    // from non-CIS IPs, and dev.hh.ru registration needs a Russian phone number.
    slug: 'hh',
    kind: 'api',
    isActive: false,
    config: { baseUrl: 'https://api.hh.ru', endpoint: '/vacancies' },
  },
  {
    // Primary source (ADR-009). Needs TELEGRAM_API_ID/TELEGRAM_API_HASH +
    // TELEGRAM_SESSION env vars; the worker skips while they're missing.
    // Channels: public RU/IT dev job channels. Each candidate is probed for
    // reachability, post frequency and vacancy-vs-noise ratio before being
    // added; resume feeds, spam chats and non-dev boards are rejected.
    // Verified live 2026-07-21: react/general (job_react, geekjobs,
    // remote_it_jobs) + frontend (rabotafrontend), Go/backend (golang_jobs)
    // and QA (qa_jobs).
    slug: 'telegram',
    kind: 'telegram',
    isActive: true,
    config: {
      channels: [
        'job_react',
        'geekjobs',
        'remote_it_jobs',
        'rabotafrontend',
        'golang_jobs',
        'qa_jobs',
      ],
      messagesPerChannel: 50,
    },
  },
  {
    slug: 'remoteok',
    kind: 'api',
    isActive: true,
    // API terms require linking back to the original posting.
    config: { feedUrl: 'https://remoteok.com/api', linkBackRequired: true },
  },
  {
    slug: 'weworkremotely',
    kind: 'rss',
    isActive: true,
    config: { feedUrl: 'https://weworkremotely.com/categories/remote-programming-jobs.rss' },
  },
  {
    // Free public JSON feed, no auth. Server-side category filter is unreliable,
    // so the worker also keeps only tech categories client-side. API terms ask
    // for a link back to the original posting — the vacancy URL provides it.
    slug: 'remotive',
    kind: 'api',
    isActive: true,
    config: {
      feedUrl: 'https://remotive.com/api/remote-jobs?category=software-dev',
      linkBackRequired: true,
    },
  },
  {
    // Free public JSON feed, no auth (industry=dev). Terms ask for a credited
    // link back and apply buttons pointing at the original posting.
    slug: 'jobicy',
    kind: 'api',
    isActive: true,
    config: {
      feedUrl: 'https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50',
      linkBackRequired: true,
    },
  },
  {
    // Free public JSON feed, no auth. Aggregates remote/contract roles
    // (freelance-leaning, e.g. Lemon.io); the worker keeps only dev categories.
    slug: 'workingnomads',
    kind: 'api',
    isActive: true,
    config: { feedUrl: 'https://www.workingnomads.com/api/exposed_jobs/', linkBackRequired: true },
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
