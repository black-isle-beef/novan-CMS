import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { auditEvents, DbService, spaces, webhookDeliveries } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import { JOBS_CONFIG, type JobsConfig, JobWorker } from '@novan/api-jobs';
import { verifyWebhookSignature, WebhookRunner } from '@novan/api-webhooks';
import type { Entry, Webhook, WebhookDelivery, WebhookPayload, WebhookWithSecret } from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// Webhooks (docs/build/17-scheduling-releases-webhooks.md). Needs the local Supabase database; RLS for webhooks and
// their deliveries is in supabase/tests/webhooks.test.sql. A receiver runs on localhost, which webhooks may call
// outside production.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
const novanAdminId = '00000000-0000-4000-8000-000000000003';
const organisationId = '00000000-0000-4000-8000-000000000100';

function jwt(sub: string, spaceId: string, role: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: 'aal1', spaces: [{ id: spaceId, role }], agency_staff: false })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));
}

const field = (apiId: string, type: string, extra: object = {}) => ({ id: apiId, apiId, label: apiId, type, ...extra });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const config: JobsConfig = { visibilitySeconds: 5, maxAttempts: 3, retryBaseSeconds: 1, retryMaxSeconds: 1, pollMs: 50, batchSize: 10, alertEmails: [] };

interface Received {
  headers: IncomingHttpHeaders;
  body: string;
}

describe.skipIf(!hasDatabase)('webhooks', () => {
  const run = Date.now();
  let app: INestApplication;
  let db: DbService;
  let space: string;
  let developer: string;
  let editor: string;
  let receiver: Server;
  let receiverUrl: string;
  let webhook: WebhookWithSecret;
  const received: Received[] = [];
  /** Status codes to answer with, in turn; 200 once they run out. */
  const answers: number[] = [];

  const server = () => app.getHttpServer();
  const as = (token: string) => ({
    get: (path: string) => request(server()).get(`/v1/management/spaces/${space}${path}`).auth(token, { type: 'bearer' }),
    post: (path: string, body: object = {}) => request(server()).post(`/v1/management/spaces/${space}${path}`).auth(token, { type: 'bearer' }).send(body),
    patch: (path: string, body: object) => request(server()).patch(`/v1/management/spaces/${space}${path}`).auth(token, { type: 'bearer' }).send(body),
    delete: (path: string) => request(server()).delete(`/v1/management/spaces/${space}${path}`).auth(token, { type: 'bearer' }),
  });
  const runWebhooks = async (): Promise<void> => {
    while (await app.get(JobWorker).runOnce('webhooks', { spaceId: space })) {
      // until none are left
    }
  };
  const publishPage = async (slug: string): Promise<Entry> => {
    const created = await as(editor).post('/environments/main/entries', { contentType: 'page', data: { title: slug, slug } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await as(editor).post(`/environments/main/entries/${created.body.id}/publish`)).status).toBe(200);
    return created.body;
  };
  const deliveries = async (): Promise<WebhookDelivery[]> => (await as(developer).get(`/webhooks/${webhook.id}/deliveries`)).body;

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = answers.shift() ?? 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks/novan`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue({ enabled: false })
      .overrideProvider(JOBS_CONFIG)
      .useValue(config)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);
    const [created] = await db.serviceDb.insert(spaces).values({ organisationId, name: 'Webhooks', slug: `webhooks-${run}` }).returning({ id: spaces.id });
    space = created.id;
    developer = await jwt(novanAdminId, space, 'developer');
    editor = await jwt(novanAdminId, space, 'editor');
    const type = await as(developer).post('/environments/main/content-types', {
      apiId: 'page',
      name: 'Page',
      kind: 'page',
      fields: [field('title', 'text', { required: true }), field('slug', 'text', { required: true })],
    });
    expect(type.status, JSON.stringify(type.body)).toBe(201);
  });

  afterAll(async () => {
    if (space) await db.serviceDb.delete(spaces).where(eq(spaces.id, space));
    await app?.close();
    await new Promise((resolve) => receiver?.close(resolve));
  });

  it('a developer makes a webhook; its secret is shown once, and editors cannot see webhooks', async () => {
    const res = await as(developer).post('/webhooks', { name: 'Search index', url: receiverUrl, events: ['entry.published', 'entry.unpublished'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    webhook = res.body;
    expect(webhook).toMatchObject({ name: 'Search index', url: receiverUrl, active: true, lastDelivery: null });
    expect(webhook.secret).toMatch(/^whsec_[\w-]{43}$/);

    const listed: Webhook[] = (await as(developer).get('/webhooks')).body;
    expect(listed.map((w) => w.id)).toEqual([webhook.id]);
    expect(listed[0]).not.toHaveProperty('secret');
    expect((await as(editor).get('/webhooks')).status).toBe(403);
    expect((await as(developer).post('/webhooks', { name: 'x', url: 'ftp://example.com', events: ['entry.published'] })).status).toBe(400);
    expect((await as(developer).post('/webhooks', { name: 'x', url: receiverUrl, events: [] })).status).toBe(400);
    const [audit] = await db.serviceDb.select().from(auditEvents).where(and(eq(auditEvents.spaceId, space), eq(auditEvents.action, 'webhook.created')));
    expect(JSON.stringify(audit.diff)).not.toContain(webhook.secret);
  });

  it('publishing sends the receiver a signed payload it can verify', async () => {
    const page = await publishPage(`signed-${run}`);
    received.length = 0;
    await runWebhooks();

    expect(received).toHaveLength(1);
    const [request] = received;
    expect(verifyWebhookSignature(webhook.secret, request.body, String(request.headers['x-novan-signature']))).toBe(true);
    expect(verifyWebhookSignature('whsec_not-the-secret-not-the-secret-not-the', request.body, String(request.headers['x-novan-signature']))).toBe(false);
    const payload: WebhookPayload = JSON.parse(request.body);
    expect(payload).toMatchObject({ type: 'entry.published', spaceId: space, data: { entryId: page.id, path: `/signed-${run}` } });
    expect(request.headers['x-novan-event']).toBe('entry.published');
    const [delivery] = await deliveries();
    expect(request.headers['x-novan-delivery']).toBe(delivery.id);
    expect(delivery).toMatchObject({ status: 'delivered', responseCode: 200, attempt: 1, error: null, eventId: payload.id });
    expect((await as(developer).get('/webhooks')).body[0].lastDelivery).toMatchObject({ status: 'delivered', responseCode: 200 });
  });

  it('retries a receiver that fails, until it answers', async () => {
    answers.push(500);
    await publishPage(`retried-${run}`);
    received.length = 0;
    await runWebhooks();
    expect(received).toHaveLength(1);
    expect((await deliveries())[0]).toMatchObject({ status: 'pending', responseCode: 500, attempt: 1, error: 'It answered 500.' });

    await sleep(1100);
    await runWebhooks();
    expect(received).toHaveLength(2);
    // Each attempt is signed afresh.
    expect(verifyWebhookSignature(webhook.secret, received[1].body, String(received[1].headers['x-novan-signature']))).toBe(true);
    expect((await deliveries())[0]).toMatchObject({ status: 'delivered', responseCode: 200, attempt: 2, error: null });
  });

  it('gives up after the last attempt, and a person can resend it', async () => {
    answers.push(503, 503, 503);
    await publishPage(`given-up-${run}`);
    received.length = 0;
    await runWebhooks();
    for (let attempt = 2; attempt <= config.maxAttempts; attempt++) {
      await sleep(1100);
      await runWebhooks();
    }
    const [failed] = await deliveries();
    expect(failed).toMatchObject({ status: 'failed', responseCode: 503, attempt: 3 });

    const resent = await as(developer).post(`/webhooks/${webhook.id}/deliveries/${failed.id}/resend`);
    expect(resent.status, JSON.stringify(resent.body)).toBe(201);
    await runWebhooks();
    expect((await deliveries())[0]).toMatchObject({ id: resent.body.id, status: 'delivered', eventId: failed.eventId });
    expect(JSON.parse(received[received.length - 1].body).id).toBe(failed.eventId);
  });

  it('sends only subscribed events, nothing while turned off, and a change once however often it is dispatched', async () => {
    const before = (await deliveries()).length;
    await as(editor).post('/redirects', { fromPath: `/old-${run}`, toPath: '/' });
    await runWebhooks();
    expect((await deliveries()).length).toBe(before);

    await as(developer).patch(`/webhooks/${webhook.id}`, { active: false });
    await publishPage(`inactive-${run}`);
    await runWebhooks();
    expect((await deliveries()).length).toBe(before);
    await as(developer).patch(`/webhooks/${webhook.id}`, { active: true });

    const job = { type: 'dispatch' as const, spaceId: space, eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), event: { type: 'entry.unpublished', entryId: 'x' } };
    await app.get(WebhookRunner).dispatch(job);
    await app.get(WebhookRunner).dispatch(job);
    const rows = await db.serviceDb.select().from(webhookDeliveries).where(eq(webhookDeliveries.eventId, job.eventId));
    expect(rows).toHaveLength(1);
    await runWebhooks();
  });

  it('a test sends a ping; a replaced secret signs from then on', async () => {
    const rotated: WebhookWithSecret = (await as(developer).post(`/webhooks/${webhook.id}/rotate-secret`)).body;
    expect(rotated.secret).not.toBe(webhook.secret);
    const ping = await as(developer).post(`/webhooks/${webhook.id}/test`);
    expect(ping.status, JSON.stringify(ping.body)).toBe(201);
    await runWebhooks();
    const last = received[received.length - 1];
    expect(JSON.parse(last.body)).toMatchObject({ type: 'ping', data: { webhookId: webhook.id } });
    expect(verifyWebhookSignature(rotated.secret, last.body, String(last.headers['x-novan-signature']))).toBe(true);
    expect(verifyWebhookSignature(webhook.secret, last.body, String(last.headers['x-novan-signature']))).toBe(false);
  });

  it('deleting a webhook deletes its deliveries', async () => {
    expect((await as(developer).delete(`/webhooks/${webhook.id}`)).status).toBe(204);
    expect(await db.serviceDb.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhook.id))).toHaveLength(0);
    expect((await as(developer).get(`/webhooks/${webhook.id}/deliveries`)).body.code).toBe('webhook_not_found');
  });
});
