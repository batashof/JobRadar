'use client';

import { APP_NAME } from '@jobradar/shared';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { useAuth } from '@/lib/auth-context';

const NAV = [
  { href: '/app', label: 'Dashboard' },
  { href: '/app/feed', label: 'Feed' },
  { href: '/app/board', label: 'Board' },
  { href: '/app/profiles', label: 'Profiles' },
  { href: '/app/resume', label: 'Resume' },
];

export function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-[var(--color-border)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <nav className="flex items-center gap-5">
          <Link href="/app" aria-label={`${APP_NAME} home`}>
            <Logo size={26} />
          </Link>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
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
