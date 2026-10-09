import { expect, type APIRequestContext } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Specs are compiled as CommonJS, so `__dirname` rather than `import.meta.dirname`.
const envFile = resolve(__dirname, '../../../../.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const supabaseUrl = process.env['SUPABASE_URL'] || 'http://127.0.0.1:54321';
export const anonKey = process.env['SUPABASE_ANON_KEY'] ?? '';
const apiUrl = process.env['NOVAN_API_URL'] || 'http://localhost:3000';

/** The seeded demo space and its pages (supabase/seed.sql). */
export const demoSpace = '00000000-0000-4000-8000-000000000200';
export const contactPage = '00000000-0000-4000-8000-000000000703';

/**
 * The management API as the seeded space admin (no second factor), signed in through Supabase Auth, as the admin
 * does. For journeys that publish: changes made through it reach the site as an editor's would.
 */
export async function management(request: APIRequestContext) {
  const response = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: { email: 'novanwebservices@gmail.com', password: 'password123' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const headers = { Authorization: `Bearer ${(await response.json()).access_token}` };
  const space = `${apiUrl}/v1/management/spaces/${demoSpace}`;
  const entries = `${space}/environments/main/entries`;
  const ok = async (call: Promise<import('@playwright/test').APIResponse>) => {
    const res = await call;
    expect(res.ok(), await res.text()).toBe(true);
    return res.status() === 204 ? null : res.json();
  };

  return {
    get: (path: string) => ok(request.get(`${space}${path}`, { headers })),
    /** Creates a page and publishes it; returns its id. */
    publishNewPage: async (data: Record<string, unknown>): Promise<string> => {
      const created = await ok(request.post(entries, { headers, data: { contentType: 'page', data } }));
      await ok(request.post(`${entries}/${created.id}/publish`, { headers }));
      return created.id;
    },
    /** Saves new data for an entry and publishes it. */
    publish: async (id: string, change: (data: Record<string, unknown>) => Record<string, unknown>) => {
      const { data } = await ok(request.get(`${entries}/${id}`, { headers }));
      await ok(request.patch(`${entries}/${id}`, { headers, data: { data: change(data), message: 'e2e @seo' } }));
      await ok(request.post(`${entries}/${id}/publish`, { headers }));
    },
    /** Takes an entry off the site and into the bin. */
    remove: (id: string) => ok(request.delete(`${entries}/${id}`, { headers })),
  };
}
