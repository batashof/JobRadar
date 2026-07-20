import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME } from '@jobradar/shared';

import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    'Personal job-search radar: aggregated vacancies and an application tracker.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
