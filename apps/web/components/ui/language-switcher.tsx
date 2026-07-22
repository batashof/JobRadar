'use client';

import { LANGUAGES, type Language } from '@jobradar/shared';

import { useI18n } from '@/lib/i18n/context';

const LABELS: Record<Language, string> = { en: 'EN', ru: 'RU' };

/** Compact EN/RU toggle (ADR-014). Persists to the account via the context. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLanguage, pending, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t('header.language')}
      className={`inline-flex items-center rounded-md border border-[var(--color-border)] p-0.5 text-xs ${className ?? ''}`}
    >
      {LANGUAGES.map((option) => {
        const active = option === lang;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            disabled={pending}
            onClick={() => setLanguage(option)}
            className={`rounded px-2 py-0.5 font-medium transition-colors disabled:opacity-60 ${
              active
                ? 'bg-[var(--color-foreground)] text-[var(--color-background)]'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
            }`}
          >
            {LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
