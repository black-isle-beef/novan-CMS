import type { CreatedApiToken, Entry, ScheduledAction } from '@novan/shared-schemas';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Background jobs end to end (docs/build/17-scheduling-releases-webhooks.md): pg_cron sends a due action to the
// `publish` queue, and the worker that `nx serve api` runs (`--with-worker`) publishes the page. Runs against the API
// as `nx run api:serve` starts it, with the local Supabase stack seeded (`npm run db:reset`). Select with `-t @jobs`.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const baseUrl = `http://${process.env['HOST'] ?? 'localhost'}:${process.env['PORT'] ?? '3000'}`;
const supabaseUrl = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const demoSpaceId = '00000000-0000-4000-8000-000000000200';
const management = `${baseUrl}/v1/management/spaces/${demoSpaceId}`;

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: process.env['SUPABASE_ANON_KEY'] ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function call<T>(method: string, url: string, token: string, body?: object): Promise<{ status: number; body: T }> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

describe('@jobs scheduled publishing', () => {
  const slug = `e2e-scheduled-${Date.now()}`;
  let session: string;
  let token: CreatedApiToken;
  let page: Entry;

  beforeAll(async () => {
    session = await signIn('novanwebservices@gmail.com', 'password123');
    const created = await call<CreatedApiToken>('POST', `${management}/api-tokens`, session, { name: 'api-e2e jobs', scope: 'delivery' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    token = created.body;
  });

  afterAll(async () => {
    if (page) await call('DELETE', `${management}/environments/main/entries/${page.id}`, session);
    if (token) await call('POST', `${management}/api-tokens/${token.id}/revoke`, session);
  });

  // pg_cron runs every minute, so a publish a minute ahead happens within about two.
  it('a publish scheduled a minute ahead goes live on its own', { timeout: 200_000 }, async () => {
    const created = await call<Entry>('POST', `${management}/environments/main/entries`, session, {
      contentType: 'page',
      data: { title: 'Scheduled by e2e', slug },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    page = created.body;

    const runAt = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await call<ScheduledAction>('POST', `${management}/environments/main/entries/${page.id}/schedule`, session, {
      action: 'publish',
      runAt,
    });
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201);
    expect((await call('GET', `${baseUrl}/v1/delivery/pages?path=/${slug}`, token.token)).status).toBe(404);

    await vi.waitFor(
      async () => {
        const delivered = await call<{ id: string }>('GET', `${baseUrl}/v1/delivery/pages?path=/${slug}`, token.token);
        expect(delivered.status).toBe(200);
        expect(delivered.body.id).toBe(page.id);
      },
      { timeout: 180_000, interval: 2_000 },
    );
    const [action] = (await call<ScheduledAction[]>('GET', `${management}/environments/main/entries/${page.id}/schedule`, session)).body;
    expect(action).toMatchObject({ id: scheduled.body.id, status: 'done' });
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(runAt));
  });
});
