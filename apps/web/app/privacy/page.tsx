import type { Metadata } from 'next';
import { APP_NAME, LANGUAGES, type Language } from '@jobradar/shared';

import { PrivacyPolicy } from '@/components/privacy-policy';
import { resolveServerLanguage } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: `Privacy policy — ${APP_NAME}`,
  description: 'What the JobRadar Telegram bot stores, who sees it and how to delete it.',
};

type PageProps = { searchParams: Promise<{ lang?: string | string[] }> };

function asLanguage(value: string | string[] | undefined): Language | undefined {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
    ? (value as Language)
    : undefined;
}

/** Public: the middleware only guards `/app`, so the bot can link here without a login. */
export default async function PrivacyPage({ searchParams }: PageProps) {
  const lang = await resolveServerLanguage(asLanguage((await searchParams).lang));
  return <PrivacyPolicy lang={lang} />;
}
