import { defineConfig } from 'drizzle-kit';
import { existsSync } from 'node:fs';

// Used only to introspect the database (`npm run db:pull`). SQL migrations in
// `supabase/migrations` are the source of truth; never generate or push from Drizzle.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  },
  schemaFilter: ['public'],
  // Raw pull output; libs/api/db/tools/pull-schema.mjs copies the fixed schema into src.
  out: 'tmp/drizzle-pull',
});
