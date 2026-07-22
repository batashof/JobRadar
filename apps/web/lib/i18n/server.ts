import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '@jobradar/shared';
import { cookies } from 'next/headers';

import { translate, type TranslationKey } from './dictionaries';
import { LANGUAGE_COOKIE } from './context';

function isLanguage(value: string | undefined): value is Language {
  return value != null && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Resolves the interface language for a server component. Reads the account
 * language mirror cookie (ADR-014), falling back to the default. Pass an
 * account language (when available) to take precedence over the cookie.
 */
export async function resolveServerLanguage(accountLanguage?: Language): Promise<Language> {
  if (accountLanguage) return accountLanguage;
  const cookie = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  return isLanguage(cookie) ? cookie : DEFAULT_LANGUAGE;
}

/** Server-side translator bound to the resolved language. */
export async function getServerT(accountLanguage?: Language): Promise<{
  lang: Language;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}> {
  const lang = await resolveServerLanguage(accountLanguage);
  return { lang, t: (key, vars) => translate(lang, key, vars) };
}
