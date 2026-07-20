'use client';

import { APP_NAME } from '@jobradar/shared';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';

export function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-[var(--color-border)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <span className="font-semibold">{APP_NAME}</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--color-muted-foreground)]">{user.email}</span>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            Log out
          </Button>
        </div>
      </div>
    </header>
  );
}
