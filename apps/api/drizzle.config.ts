import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// Local dev reads the repo-root .env; in CI/hosting DATABASE_URL comes from the environment.
config({ path: '../../.env' });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://jobradar:jobradar@localhost:5432/jobradar',
  },
});
