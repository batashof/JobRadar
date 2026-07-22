'use client';

import { loginSchema, signupSchema } from '@jobradar/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { Logo } from '@/components/ui/logo';
import { ApiError } from '@/lib/api';
import { login, signup } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/context';

type Mode = 'login' | 'signup';

const ALT_HREF: Record<Mode, string> = { login: '/signup', signup: '/login' };

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const schema = mode === 'signup' ? signupSchema : loginSchema;
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('common.invalidInput'));
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await signup(parsed.data);
      } else {
        await login(parsed.data);
      }
      router.replace('/app');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="flex items-center gap-4">
        <Logo size={36} />
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t(`auth.${mode}.title`)}</CardTitle>
          <CardDescription>{t(`auth.${mode}.description`)}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-[var(--color-destructive)]">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="flex-col gap-4">
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('auth.submitting') : t(`auth.${mode}.cta`)}
            </Button>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {t(`auth.${mode}.alt`)}{' '}
              <Link href={ALT_HREF[mode]} className="text-[var(--color-primary)] hover:underline">
                {t(`auth.${mode}.altLabel`)}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
