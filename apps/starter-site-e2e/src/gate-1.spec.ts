import { expect, test, type APIRequestContext } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Gate 1 (docs/build/10-blocks-starter-site.md), locally: change the About page's title, publish, reload the
// starter site and the new title is there. Signs in as the seeded admin (no second factor) through Supabase
// Auth and uses the management API as the admin does. On staging the same change must show within 5 seconds
// through Cloudflare, which is checked there by hand.

// Specs are compiled as CommonJS, so `__dirname` rather than `import.meta.dirname`.
const envFile = resolve(__dirname, '../../../.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const supabaseUrl = process.env['SUPABASE_URL'] || 'http://127.0.0.1:54321';
const anonKey = process.env['SUPABASE_ANON_KEY'] ?? '';
const apiUrl = process.env['NOVAN_API_URL'] || 'http://localhost:3000';
const space = '00000000-0000-4000-8000-000000000200';
const about = '00000000-0000-4000-8000-000000000702';
const entryUrl = `${apiUrl}/v1/management/spaces/${space}/environments/main/entries/${about}`;

async function signIn(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: { email: 'novanwebservices@gmail.com', password: 'password123' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).access_token;
}

async function publishTitle(request: APIRequestContext, token: string, title: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` };
  const entry = await request.get(entryUrl, { headers });
  expect(entry.ok(), await entry.text()).toBe(true);
  const { data } = await entry.json();
  const saved = await request.patch(entryUrl, { headers, data: { data: { ...data, title }, message: 'Gate 1 check' } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const published = await request.post(`${entryUrl}/publish`, { headers });
  expect(published.ok(), await published.text()).toBe(true);
}

// Runs in its own project (playwright.config.mts), once, after the other tests.
test.describe('Gate 1 @gate1', () => {
  test.skip(!anonKey, 'needs SUPABASE_ANON_KEY (.env.local)');

  test('a title published in the CMS appears on the starter site on the next load', async ({ page, request }) => {
    const token = await signIn(request);
    const title = `About us ${Date.now()}`;
    try {
      await page.goto('/about');
      await expect(page).toHaveTitle('About | Novan demo site');

      await publishTitle(request, token, title);
      await page.reload();

      await expect(page).toHaveTitle(`${title} | Novan demo site`);
    } finally {
      await publishTitle(request, token, 'About');
    }
  });
});
