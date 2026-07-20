import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppHeader } from '@/components/app-header';
import { AuthProvider } from '@/lib/auth-context';
import { getCurrentUser } from '@/lib/server-auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <AuthProvider user={user}>
      <div className="min-h-screen">
        <AppHeader />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </div>
    </AuthProvider>
  );
}
