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
    // and QA (qa_jobs). 2026-07-24: FreeVacanciesIT (IT freelance/contract) —
    // the one clean IT board out of the freelance candidates probed; the rest
    // were dead archives, marketing/content boards or spam.
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
        'FreeVacanciesIT',
      ],
      messagesPerChannel: 50,
    },
  },
  {
    // Deactivated 2026-07-28 (ADR-016): their free API degraded into a scraped
    // web index — 0 of 100 items in a live sample were IT vacancies, and every
    // item carries an anti-spam footer as its whole "description".
    slug: 'remoteok',
    kind: 'api',
    isActive: false,
    // API terms require linking back to the original posting.
    config: { feedUrl: 'https://remoteok.com/api', linkBackRequired: true },
  },
  {
    // The general programming feed is the smallest one WWR publishes; the
    // per-speciality feeds carry an order of magnitude more postings and
    // overlap, so the worker fetches all of them and dedupes by guid.
    slug: 'weworkremotely',
    kind: 'rss',
    isActive: true,
    config: {
      feedUrls: [
        'https://weworkremotely.com/categories/remote-programming-jobs.rss',
        'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
        'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
        'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
        'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
      ],
    },
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
      // `dev` and `engineering` are aliases of the same slice, so the extra
      // feeds are the industries the dev feed genuinely misses.
      feedUrls: [
        'https://jobicy.com/api/v2/remote-jobs?industry=dev&count=50',
        'https://jobicy.com/api/v2/remote-jobs?industry=data-science&count=50',
        'https://jobicy.com/api/v2/remote-jobs?industry=cybersecurity&count=50',
        'https://jobicy.com/api/v2/remote-jobs?industry=qa-testing&count=50',
      ],
      linkBackRequired: true,
    },
  },
  {
    // "Ask HN: Who is hiring?" — the monthly thread, read through the Algolia
    // HN search API (bulk comment fetch; the Firebase API would need one
    // request per comment). Two threads back, so the feed does not empty out on
    // the 1st of the month. Onsite-only posts are dropped by the worker.
    slug: 'hn',
    kind: 'api',
    isActive: true,
    config: { apiBaseUrl: 'https://hn.algolia.com/api/v1', threads: 2 },
  },
  {
    // Company career pages read straight from their ATS — the highest-quality
    // data in the pipeline (no aggregator, no boilerplate, no stale reposts).
    // All three APIs are public and unauthenticated. The list is curated, not
    // discovered: each token was probed live on 2026-07-28 and kept only when
    // it yielded 6+ remote engineering roles. Adding a company is a one-line
    // config change — find the token in its careers-page URL.
    slug: 'ats',
    kind: 'api',
    isActive: true,
    config: {
      companies: [
        { ats: 'greenhouse', token: 'gitlab', name: 'GitLab' },
        { ats: 'greenhouse', token: 'grafanalabs', name: 'Grafana Labs' },
        { ats: 'greenhouse', token: 'mozilla', name: 'Mozilla' },
        { ats: 'greenhouse', token: 'twilio', name: 'Twilio' },
        { ats: 'greenhouse', token: 'reddit', name: 'Reddit' },
        { ats: 'greenhouse', token: 'affirm', name: 'Affirm' },
        { ats: 'greenhouse', token: 'samsara', name: 'Samsara' },
        { ats: 'greenhouse', token: 'coinbase', name: 'Coinbase' },
        { ats: 'greenhouse', token: 'pinterest', name: 'Pinterest' },
        { ats: 'greenhouse', token: 'instacart', name: 'Instacart' },
        { ats: 'greenhouse', token: 'databricks', name: 'Databricks' },
        { ats: 'greenhouse', token: 'temporaltechnologies', name: 'Temporal' },
        { ats: 'greenhouse', token: 'tailscale', name: 'Tailscale' },
        { ats: 'greenhouse', token: 'cloudflare', name: 'Cloudflare' },
        { ats: 'greenhouse', token: 'fivetran', name: 'Fivetran' },
        { ats: 'greenhouse', token: 'stripe', name: 'Stripe' },
        { ats: 'greenhouse', token: 'datadog', name: 'Datadog' },
        { ats: 'greenhouse', token: 'webflow', name: 'Webflow' },
        { ats: 'greenhouse', token: 'dropbox', name: 'Dropbox' },
        { ats: 'greenhouse', token: 'remotecom', name: 'Remote.com' },
        { ats: 'greenhouse', token: 'airtable', name: 'Airtable' },
        { ats: 'greenhouse', token: 'vercel', name: 'Vercel' },
        { ats: 'greenhouse', token: 'algolia', name: 'Algolia' },
        { ats: 'ashby', token: 'Supabase', name: 'Supabase' },
        { ats: 'ashby', token: 'vanta', name: 'Vanta' },
        { ats: 'ashby', token: 'elevenlabs', name: 'ElevenLabs' },
        { ats: 'ashby', token: 'render', name: 'Render' },
        { ats: 'ashby', token: 'openai', name: 'OpenAI' },
        { ats: 'ashby', token: 'langchain', name: 'LangChain' },
        { ats: 'ashby', token: 'cursor', name: 'Cursor' },
        { ats: 'ashby', token: 'linear', name: 'Linear' },
        { ats: 'ashby', token: 'resend', name: 'Resend' },
        { ats: 'ashby', token: 'railway', name: 'Railway' },
        { ats: 'ashby', token: 'harvey', name: 'Harvey' },
        { ats: 'lever', token: 'veeva', name: 'Veeva Systems' },
        { ats: 'lever', token: 'spotify', name: 'Spotify' },
      ],
    },
  },
  {
    // Remote-only board with the richest structured data of the free feeds
    // (annual salary, seniority, employment type, location restrictions). The
    // API has no server-side category filter and clamps a page to 20 items, so
    // the worker pages through the newest postings and keeps tech roles only.
    slug: 'himalayas',
    kind: 'api',
    isActive: true,
    config: { feedUrl: 'https://himalayas.app/jobs/api', pages: 10, linkBackRequired: true },
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
