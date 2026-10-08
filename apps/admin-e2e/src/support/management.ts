import { expect, type APIRequestContext } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spaceAdmin } from './auth';

// Specs are compiled as CommonJS, so `__dirname` rather than `import.meta.dirname`.
const envFile = resolve(__dirname, '../../../../.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const supabaseUrl = process.env['SUPABASE_URL'] || 'http://127.0.0.1:54321';
const anonKey = process.env['SUPABASE_ANON_KEY'] ?? '';
const apiUrl = process.env['NOVAN_API_URL'] || 'http://localhost:3000';

/** Signs the seeded space admin (no second factor) in through Supabase Auth, for the management API. */
async function token(request: APIRequestContext): Promise<string> {
  expect(anonKey, 'needs SUPABASE_ANON_KEY (.env.local)').not.toBe('');
  const response = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: spaceAdmin,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).access_token;
}

/**
 * Keeps a seeded page as it is now and returns a function that saves and publishes it again, so a journey
 * that publishes a seeded page leaves it as the other e2e projects (starter-site-e2e) expect it.
 */
export async function keepPublished(request: APIRequestContext, spaceId: string, entryId: string): Promise<() => Promise<void>> {
  const headers = { Authorization: `Bearer ${await token(request)}` };
  const entryUrl = `${apiUrl}/v1/management/spaces/${spaceId}/environments/main/entries/${entryId}`;
  const entry = await request.get(entryUrl, { headers });
  expect(entry.ok(), await entry.text()).toBe(true);
  const { data } = await entry.json();
  return async () => {
    const saved = await request.patch(entryUrl, { headers, data: { data, message: 'Put back after an e2e journey' } });
    expect(saved.ok(), await saved.text()).toBe(true);
    const published = await request.post(`${entryUrl}/publish`, { headers });
    expect(published.ok(), await published.text()).toBe(true);
  };
}
