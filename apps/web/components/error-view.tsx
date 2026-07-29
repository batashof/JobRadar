'use client';

import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '@jobradar/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { translate } from '@/lib/i18n/dictionaries';
import { LANGUAGE_COOKIE } from '@/lib/i18n/context';

/** How long the health probe waits before calling the API unreachable. */
const PROBE_TIMEOUT_MS = 8_000;

/**
 * Next.js strips error messages crossing the server/client boundary in
 * production, so the boundary cannot tell an API outage from a genuine bug by
 * inspecting the error. It asks the API directly instead — one cheap health
 * probe — and only then decides which explanation to show.
 */
type Diagnosis = 'checking' | 'api-down' | 'app-error';

/** Reads the account-language mirror cookie (ADR-014); no provider needed. */
function readLanguage(): Language {
  if (typeof document === 'undefined') return DEFAULT_LANGUAGE;
  const value = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${LANGUAGE_COOKIE}=`))
    ?.slice(LANGUAGE_COOKIE.length + 1);
  return (LANGUAGES as readonly string[]).includes(value ?? '')
    ? (value as Language)
    : DEFAULT_LANGUAGE;
}

export function ErrorView({ reset }: { reset: () => void }) {
  // Lazy initialiser, not an effect: the cookie is available on first client
  // render, and error boundaries render on the client anyway.
  const [lang] = useState<Language>(readLanguage);
  const [diagnosis, setDiagnosis] = useState<Diagnosis>('checking');

  useEffect(() => {
    let active = true;
    fetch('/api/health', { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      .then((res) => {
        if (active) setDiagnosis(res.ok ? 'app-error' : 'api-down');
      })
      .catch(() => {
        if (active) setDiagnosis('api-down');
      });
    return () => {
      active = false;
    };
  }, []);

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const down = diagnosis === 'api-down';

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>{t(down ? 'error.offline.title' : 'common.somethingWrong')}</CardTitle>
          <CardDescription>
            {t(down ? 'error.offline.description' : 'error.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button onClick={reset}>{t('common.retry')}</Button>
          <Button variant="outline" asChild>
            <Link href="/app">{t('error.home')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
