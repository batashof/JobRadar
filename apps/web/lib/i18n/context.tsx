'use client';

import type { AuthResponse, Language } from '@jobradar/shared';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import { apiFetch } from '@/lib/api';
import { translate, type TFunction } from './dictionaries';

/**
 * Non-httpOnly cookie mirroring the account language (ADR-014). The account is
 * the source of truth; this cookie lets server components (incl. pre-auth
 * pages) render the right language without a DB round-trip.
 */
export const LANGUAGE_COOKIE = 'jr_lang';

interface I18nContextValue {
  lang: Language;
  t: TFunction;
  setLanguage: (next: Language) => void;
  pending: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function writeCookie(lang: Language): void {
  // 1-year, lax, root path — readable by server components on the next request.
  document.cookie = `${LANGUAGE_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
}

/** Seeds client components with the active language and a persisted setter. */
export function I18nProvider({
  initialLanguage,
  persist = true,
  children,
}: {
  initialLanguage: Language;
  /** When false (pre-auth pages), the change is cookie-only — no /auth/me call. */
  persist?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [lang, setLang] = useState<Language>(initialLanguage);
  const [pending, setPending] = useState(false);

  const setLanguage = useCallback(
    (next: Language) => {
      if (next === lang) return;
      setLang(next); // optimistic — the UI switches immediately
      writeCookie(next);
      const finish = () => {
        setPending(false);
        router.refresh(); // re-render server components (brief/fit reload in `next`)
      };
      setPending(true);
      if (!persist) {
        finish();
        return;
      }
      apiFetch<AuthResponse>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ language: next }),
      })
        .catch(() => undefined)
        .finally(finish);
    },
    [lang, persist, router],
  );

  const t = useCallback<TFunction>((key, vars) => translate(lang, key, vars), [lang]);

  return (
    <I18nContext.Provider value={{ lang, t, setLanguage, pending }}>{children}</I18nContext.Provider>
  );
}

/**
 * Falls back to a no-op English context when rendered outside a provider. The
 * app always wraps its trees in `I18nProvider` (seeded from the account), so
 * this default only applies in isolated unit tests.
 */
const DEFAULT_CONTEXT: I18nContextValue = {
  lang: 'en',
  t: (key, vars) => translate('en', key, vars),
  setLanguage: () => undefined,
  pending: false,
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? DEFAULT_CONTEXT;
}
