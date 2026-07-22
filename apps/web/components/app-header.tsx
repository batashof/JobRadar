'use client';

import { APP_NAME } from '@jobradar/shared';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { Logo } from '@/components/ui/logo';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n/context';
import type { TranslationKey } from '@/lib/i18n/dictionaries';

const NAV: { href: string; key: TranslationKey }[] = [
  { href: '/app', key: 'nav.dashboard' },
  { href: '/app/feed', key: 'nav.feed' },
  { href: '/app/board', key: 'nav.board' },
  { href: '/app/profiles', key: 'nav.profiles' },
  { href: '/app/resume', key: 'nav.resume' },
  { href: '/app/interview', key: 'nav.interview' },
];

export function AppHeader() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

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
              className="hidden text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] md:inline"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 text-sm md:flex">
          <LanguageSwitcher />
          <span className="text-[var(--color-muted-foreground)]">{user.email}</span>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            {t('nav.logout')}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X /> : <Menu />}
        </Button>
      </div>
      {menuOpen && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2 py-2 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                onClick={() => setMenuOpen(false)}
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3 text-sm">
            <span className="truncate text-[var(--color-muted-foreground)]">{user.email}</span>
            <div className="flex items-center gap-3">
              <LanguageSwitcher />
              <Button variant="outline" size="sm" onClick={() => void logout()}>
                {t('nav.logout')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
