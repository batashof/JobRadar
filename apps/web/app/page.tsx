import { redirect } from 'next/navigation';

// The app lives under /app (auth-protected); the marketing/landing surface is out
// of scope for the personal tool, so the root just forwards there.
export default function HomePage() {
  redirect('/app');
}
