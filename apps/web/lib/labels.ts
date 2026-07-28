/**
 * Display names for known source slugs; unknown slugs fall back to the slug
 * itself. Source names are brand names — not translated (ADR-014). Work-format,
 * employment-type and application-stage labels live in the i18n dictionaries.
 */
const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  remoteok: 'RemoteOK',
  weworkremotely: 'WeWorkRemotely',
  remotive: 'Remotive',
  jobicy: 'Jobicy',
  himalayas: 'Himalayas',
  hn: 'Hacker News',
  workingnomads: 'Working Nomads',
  hh: 'hh.ru',
};

export function sourceLabel(slug: string): string {
  return SOURCE_LABELS[slug] ?? slug;
}
