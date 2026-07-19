import { APP_NAME } from '@jobradar/shared';

export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 2rem' }}>
      <h1>{APP_NAME}</h1>
      <p>Hello world — phase 0 scaffold. The radar is warming up.</p>
    </main>
  );
}
