import type { Language } from '@jobradar/shared';

import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { BOT_URL, PRIVACY_TEXT } from '@/lib/privacy';

const OTHER: Record<Language, { lang: Language; label: string }> = {
  en: { lang: 'ru', label: 'Русский' },
  ru: { lang: 'en', label: 'English' },
};

/** The privacy policy the bot links to from `/privacy` and BotFather (ADR-024 §7–8). */
export function PrivacyPolicy({ lang }: { lang: Language }) {
  const t = PRIVACY_TEXT[lang];
  const other = OTHER[lang];
  return (
    <main lang={lang} className="mx-auto w-full max-w-3xl px-4 py-8 pb-16">
      <div className="flex items-center justify-between">
        <Logo />
        <a href={`/privacy?lang=${other.lang}`} className="text-sm underline">
          {other.label}
        </a>
      </div>
      <article className="flex flex-col gap-8 py-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-[var(--color-muted-foreground)]">{t.intro}</p>
        </header>
        {t.sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
            {section.items ? (
              <ul className="list-disc space-y-1.5 pl-5">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <div>
          <Button asChild variant="outline">
            <a href={BOT_URL} target="_blank" rel="noopener noreferrer">
              {t.openInTelegram}
            </a>
          </Button>
        </div>
      </article>
    </main>
  );
}
