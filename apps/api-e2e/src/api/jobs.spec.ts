import { verifyWebhookSignature } from '@novan/api-webhooks';
import type { CreatedApiToken, Entry, ScheduledAction, WebhookDelivery, WebhookPayload, WebhookWithSecret } from '@novan/shared-schemas';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

// Background jobs end to end (docs/build/17-scheduling-releases-webhooks.md), with the worker that `nx serve api` runs
// (`--with-worker`): webhooks reach a receiver started here, signed and retried; pg_cron sends a due action to the
// `publish` queue and the worker publishes the page. Runs against the API
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

describe('@jobs webhooks', () => {
  let session: string;
  let receiver: Server;
  let webhook: WebhookWithSecret;
  const received: { body: string; signature: string; event: string }[] = [];
  /** Status codes to answer with, in turn; 200 once they run out. */
  const answers: number[] = [];
  const pages: string[] = [];

  beforeAll(async () => {
    session = await signIn('novanwebservices@gmail.com', 'password123');
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ body, signature: String(req.headers['x-novan-signature']), event: String(req.headers['x-novan-event']) });
        res.statusCode = answers.shift() ?? 200;
        res.end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks`;
    const created = await call<WebhookWithSecret>('POST', `${management}/webhooks`, session, { name: 'api-e2e receiver', url, events: ['entry.published'] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    webhook = created.body;
  });

  afterAll(async () => {
    for (const id of pages) await call('DELETE', `${management}/environments/main/entries/${id}`, session);
    if (webhook) await call('DELETE', `${management}/webhooks/${webhook.id}`, session);
    await new Promise((resolve) => receiver?.close(resolve));
  });

  async function publish(slug: string): Promise<Entry> {
    const created = await call<Entry>('POST', `${management}/environments/main/entries`, session, { contentType: 'page', data: { title: slug, slug } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    pages.push(created.body.id);
    expect((await call('POST', `${management}/environments/main/entries/${created.body.id}/publish`, session)).status).toBe(200);
    return created.body;
  }

  const forPage = (id: string) => received.filter((r) => (JSON.parse(r.body) as WebhookPayload).data['entryId'] === id);

  it('the receiver gets a signed payload when a page is published', { timeout: 30_000 }, async () => {
    const page = await publish(`e2e-webhook-${Date.now()}`);
    await vi.waitFor(() => expect(forPage(page.id)).toHaveLength(1), { timeout: 20_000, interval: 250 });
    const [request] = forPage(page.id);
    expect(verifyWebhookSignature(webhook.secret, request.body, request.signature)).toBe(true);
    expect(request.event).toBe('entry.published');
    expect(JSON.parse(request.body)).toMatchObject({ type: 'entry.published', spaceId: demoSpaceId, data: { entryId: page.id } });
  });

  it('a failing receiver is retried until it answers', { timeout: 90_000 }, async () => {
    answers.push(500);
    const page = await publish(`e2e-webhook-retry-${Date.now()}`);
    // The first retry comes about 10 seconds after the failure.
    await vi.waitFor(() => expect(forPage(page.id)).toHaveLength(2), { timeout: 60_000, interval: 500 });
    const [first, second] = forPage(page.id);
    expect(JSON.parse(first.body).id).toBe(JSON.parse(second.body).id);
    expect(verifyWebhookSignature(webhook.secret, second.body, second.signature)).toBe(true);
    await vi.waitFor(async () => {
      const deliveries = (await call<WebhookDelivery[]>('GET', `${management}/webhooks/${webhook.id}/deliveries`, session)).body;
      expect(deliveries.find((d) => d.eventId === JSON.parse(second.body).id)).toMatchObject({ status: 'delivered', attempt: 2, responseCode: 200 });
    });
  });
});

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
