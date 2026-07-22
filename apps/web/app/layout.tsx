import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME } from '@jobradar/shared';

import { resolveServerLanguage } from '@/lib/i18n/server';
import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    'Personal job-search radar: aggregated vacancies and an application tracker.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await resolveServerLanguage();
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
