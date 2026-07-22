import { AuthForm } from '@/components/auth-form';
import { I18nProvider } from '@/lib/i18n/context';
import { resolveServerLanguage } from '@/lib/i18n/server';

export default async function LoginPage() {
  const lang = await resolveServerLanguage();
  return (
    <I18nProvider initialLanguage={lang} persist={false}>
      <AuthForm mode="login" />
    </I18nProvider>
  );
}
