import type { CreatedApiToken, DeliveryEntry, Entry } from '@novan/shared-schemas';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeCloudflareUrl, purgesAreRecorded, type RecordedPurge } from '../support/fake-cloudflare';

// Runs against the API as `nx run api:serve` starts it, with the local Supabase stack seeded
// (`npm run db:reset`): it signs in as the seeded Novan Admin, an admin of the demo space.
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

async function call<T>(method: string, url: string, token: string, body?: object): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T, headers: res.headers };
}

const purges = async (): Promise<RecordedPurge[]> => (await fetch(`${fakeCloudflareUrl}/__purges`)).json() as Promise<RecordedPurge[]>;

describe('publishing reaches the Delivery API and purges the CDN', () => {
  const slug = `e2e-delivery-${Date.now()}`;
  let session: string;
  let token: CreatedApiToken;
  let page: Entry;

  beforeAll(async () => {
    session = await signIn('novanwebservices@gmail.com', 'password123');
    const created = await call<CreatedApiToken>('POST', `${management}/api-tokens`, session, { name: 'api-e2e', scope: 'delivery' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    token = created.body;
  });

  afterAll(async () => {
    if (page) await call('DELETE', `${management}/environments/main/entries/${page.id}`, session);
    if (token) await call('POST', `${management}/api-tokens/${token.id}/revoke`, session);
  });

  it('a page is not delivered until it is published, then is', async () => {
    const created = await call<Entry>('POST', `${management}/environments/main/entries`, session, {
      contentType: 'page',
      data: { title: 'Delivered by e2e', slug },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    page = created.body;

    const before = await call('GET', `${baseUrl}/v1/delivery/pages?path=/${slug}`, token.token);
    expect(before.status).toBe(404);
    expect(before.headers.get('cache-control')).toBe('no-store');

    const published = await call<Entry>('POST', `${management}/environments/main/entries/${page.id}/publish`, session);
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    const delivered = await call<DeliveryEntry>('GET', `${baseUrl}/v1/delivery/pages?path=/${slug}`, token.token);
    expect(delivered.status).toBe(200);
    expect(delivered.body).toMatchObject({ id: page.id, path: `/${slug}`, data: { title: 'Delivered by e2e' } });
    expect(delivered.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=31536000, stale-while-revalidate=60');
    expect(delivered.headers.get('cache-tag')).toContain(`entry:${page.id}`);
  });

  it('publishing a change delivers the new content', async () => {
    await call('PATCH', `${management}/environments/main/entries/${page.id}`, session, { data: { title: 'Changed by e2e', slug } });
    const draft = await call<DeliveryEntry>('GET', `${baseUrl}/v1/delivery/pages?path=/${slug}`, token.token);
    expect(draft.body.data['title']).toBe('Delivered by e2e');

    await call('POST', `${management}/environments/main/entries/${page.id}/publish`, session);
    const delivered = await call<DeliveryEntry>('GET', `${baseUrl}/v1/delivery/pages?path=/${slug}`, token.token);
    expect(delivered.body.data['title']).toBe('Changed by e2e');
  });

  // Needs the API pointed at the fake Cloudflare API (CI's e2e step does; see `purgesAreRecorded`). The purge is a job on
  // the `purge` queue, so it lands when the worker next polls (every `JOBS_POLL_MS`, a second by default).
  it.skipIf(!purgesAreRecorded)('publishing purges the CDN by the entry, its type, the lists and the sitemap', { timeout: 30_000 }, async () => {
    const purgedBefore = (await purges()).length;
    await call('POST', `${management}/environments/main/entries/${page.id}/publish`, session);

    await vi.waitFor(
      async () => {
        const recent = (await purges()).slice(purgedBefore);
        expect(recent.some((p) => p.body.tags?.includes(`entry:${page.id}`))).toBe(true);
      },
      { timeout: 20_000, interval: 250 },
    );
    const purge = (await purges()).slice(purgedBefore).find((p) => p.body.tags?.includes(`entry:${page.id}`));
    expect(purge?.zone).toBe('e2e-zone');
    expect(purge?.authorization).toBe('Bearer e2e-token');
    expect(purge?.body.tags).toEqual(
      expect.arrayContaining([
        `entry:${page.id}`,
        `overflow:${demoSpaceId}`,
        expect.stringMatching(/^type:[0-9a-f-]{36}:page$/),
        expect.stringMatching(/^sitemap:/),
        expect.stringMatching(/^entries:/),
      ]),
    );
  });

  it('unpublishing takes the page off the Delivery API', async () => {
    await call('POST', `${management}/environments/main/entries/${page.id}/unpublish`, session);
    expect((await call('GET', `${baseUrl}/v1/delivery/pages?path=/${slug}`, token.token)).status).toBe(404);
  });

  it('serves the OpenAPI document', async () => {
    const res = await fetch(`${baseUrl}/v1/docs`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/v1/delivery/pages', '/v1/preview/pages', '/v1/management/spaces/{spaceId}/api-tokens']));
  });
});
