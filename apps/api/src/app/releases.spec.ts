import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { DbService, members, publishedContent, roles, scheduledActions, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import { JobWorker } from '@novan/api-jobs';
import type { Entry, ReleaseDetail } from '@novan/shared-schemas';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// Releases (docs/build/17-scheduling-releases-webhooks.md). Needs the local Supabase database; RLS for releases and
// release_items is in supabase/tests/releases.test.sql.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
const clientId = '00000000-0000-4000-8000-000000000002';
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

const cloudflare = {
  enabled: true,
  purgeTags: vi.fn<(tags: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
  purgeUrls: vi.fn<(urls: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
};

describe.skipIf(!hasDatabase)('releases', () => {
  const run = Date.now();
  let app: INestApplication;
  let db: DbService;
  let spaceA: string;
  let spaceB: string;
  let editorA: string;
  let authorA: string;
  let editorB: string;
  let adminB: string;

  const server = () => app.getHttpServer();
  const as = (spaceId: string, token: string) => ({
    get: (path: string) => request(server()).get(`/v1/management/spaces/${spaceId}/environments/main${path}`).auth(token, { type: 'bearer' }),
    post: (path: string, body: object = {}) =>
      request(server()).post(`/v1/management/spaces/${spaceId}/environments/main${path}`).auth(token, { type: 'bearer' }).send(body),
    put: (path: string, body: object = {}) =>
      request(server()).put(`/v1/management/spaces/${spaceId}/environments/main${path}`).auth(token, { type: 'bearer' }).send(body),
    patch: (path: string, body: object) =>
      request(server()).patch(`/v1/management/spaces/${spaceId}/environments/main${path}`).auth(token, { type: 'bearer' }).send(body),
    delete: (path: string) => request(server()).delete(`/v1/management/spaces/${spaceId}/environments/main${path}`).auth(token, { type: 'bearer' }),
  });
  const page = async (spaceId: string, token: string, data: object): Promise<Entry> => {
    const res = await as(spaceId, token).post('/entries', { contentType: 'page', data });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const release = async (spaceId: string, token: string, name: string, pages: Entry[]): Promise<ReleaseDetail> => {
    const created = await as(spaceId, token).post('/releases', { name });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    let detail: ReleaseDetail = created.body;
    for (const p of pages) detail = (await as(spaceId, token).put(`/releases/${detail.id}/items/${p.id}`)).body;
    return detail;
  };
  const live = async (ids: string[]) => db.serviceDb.select().from(publishedContent).where(inArray(publishedContent.entryId, ids));
  const runDue = async (spaceId: string): Promise<void> => {
    await db.serviceDb
      .update(scheduledActions)
      .set({ runAt: sql`now() - interval '1 second'` })
      .where(and(eq(scheduledActions.spaceId, spaceId), eq(scheduledActions.status, 'scheduled')));
    await db.serviceDb.execute(sql`select public.enqueue_due_scheduled_actions()`);
    while (await app.get(JobWorker).runOnce('publish', { spaceId })) {
      // until none are left
    }
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue(cloudflare)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);

    const [a, b] = await db.serviceDb
      .insert(spaces)
      .values([
        { organisationId, name: 'Releases A', slug: `releases-a-${run}` },
        { organisationId, name: 'Releases B', slug: `releases-b-${run}`, requireApproval: true },
      ])
      .returning({ id: spaces.id });
    spaceA = a.id;
    spaceB = b.id;
    const role = async (spaceId: string, key: string) =>
      (await db.serviceDb.select({ id: roles.id }).from(roles).where(and(eq(roles.spaceId, spaceId), eq(roles.key, key))))[0].id;
    // The worker publishes scheduled releases as whoever scheduled them, with their memberships in the database.
    await db.serviceDb.insert(members).values([
      { spaceId: spaceA, userId: novanAdminId, roleId: await role(spaceA, 'editor') },
      { spaceId: spaceB, userId: clientId, roleId: await role(spaceB, 'admin') },
    ]);
    editorA = await jwt(novanAdminId, spaceA, 'editor');
    authorA = await jwt(clientId, spaceA, 'author');
    editorB = await jwt(novanAdminId, spaceB, 'editor');
    adminB = await jwt(clientId, spaceB, 'admin');
    for (const spaceId of [spaceA, spaceB]) {
      const created = await request(server())
        .post(`/v1/management/spaces/${spaceId}/environments/main/content-types`)
        .auth(await jwt(novanAdminId, spaceId, 'developer'), { type: 'bearer' })
        .send({ apiId: 'page', name: 'Page', kind: 'page', fields: [field('title', 'text', { required: true }), field('slug', 'text', { required: true })] });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
    }
  });

  afterAll(async () => {
    if (spaceA) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceA));
    if (spaceB) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceB));
    await app?.close();
  });

  it('publishes every page at the version the release names, together, and queues their purges', async () => {
    const editor = as(spaceA, editorA);
    const launch = await page(spaceA, editorA, { title: 'Launch v1', slug: `launch-${run}` });
    const pricing = await page(spaceA, editorA, { title: 'Pricing', slug: `pricing-${run}` });
    const detail = await release(spaceA, editorA, 'Autumn launch', [launch, pricing]);
    expect(detail.items.map((i) => [i.title, i.current, i.live])).toEqual([
      ['Launch v1', true, false],
      ['Pricing', true, false],
    ]);
    // The page changes after it was added: the release still publishes the version it names.
    await editor.patch(`/entries/${launch.id}`, { data: { title: 'Launch v2', slug: `launch-${run}` } });
    expect((await editor.get(`/releases/${detail.id}`)).body.items[0]).toMatchObject({ title: 'Launch v1', current: false });

    const published = await editor.post(`/releases/${detail.id}/publish`);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body).toMatchObject({ status: 'published', publishedBy: novanAdminId, itemCount: 2 });
    const rows = await live([launch.id, pricing.id]);
    expect(rows.map((r) => (r.data as { title: string }).title).sort()).toEqual(['Launch v1', 'Pricing']);
    expect(new Set(rows.map((r) => r.publishedAt)).size).toBe(1);

    cloudflare.purgeTags.mockClear();
    while (await app.get(JobWorker).runOnce('purge', { spaceId: spaceA })) {
      // until none are left
    }
    const purged = cloudflare.purgeTags.mock.calls.flatMap((call) => call[0]);
    expect(purged).toEqual(expect.arrayContaining([`entry:${launch.id}`, `entry:${pricing.id}`]));

    // A published release stays as it was published.
    expect((await editor.patch(`/releases/${detail.id}`, { name: 'Renamed' })).body.code).toBe('release_published');
    expect((await editor.delete(`/releases/${detail.id}`)).body.code).toBe('release_published');
  });

  it('publishes nothing when one page cannot be published, and says which and why', async () => {
    const good = await page(spaceA, editorA, { title: 'Good', slug: `good-${run}` });
    const incomplete = await page(spaceA, editorA, { slug: `incomplete-${run}` });
    const binned = await page(spaceA, editorA, { title: 'Binned', slug: `binned-${run}` });
    const detail = await release(spaceA, editorA, 'Mixed', [good, incomplete, binned]);
    await as(spaceA, editorA).delete(`/entries/${binned.id}`);

    const res = await as(spaceA, editorA).post(`/releases/${detail.id}/publish`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('release_invalid');
    expect(Object.keys(res.body.errors).sort()).toEqual([`binned-${run}`, `incomplete-${run}`]);
    expect(res.body.errors[`binned-${run}`][0]).toContain('in the bin');
    expect(await live([good.id, incomplete.id, binned.id])).toHaveLength(0);
    expect((await as(spaceA, editorA).get(`/releases/${detail.id}`)).body.status).toBe('draft');
  });

  it('refuses an empty release, authors, and other spaces', async () => {
    const empty = await release(spaceA, editorA, 'Empty', []);
    expect((await as(spaceA, editorA).post(`/releases/${empty.id}/publish`)).body.code).toBe('release_empty');
    expect((await as(spaceA, authorA).post('/releases', { name: 'Mine' })).status).toBe(403);
    expect((await as(spaceA, authorA).get('/releases')).status).toBe(200);
    expect((await as(spaceA, editorB).get(`/releases/${empty.id}`)).status).toBe(403);
    expect((await as(spaceB, editorB).get(`/releases/${empty.id}`)).body.code).toBe('release_not_found');
  });

  it('with approval on, only space admins publish or schedule a release', async () => {
    const p = await page(spaceB, adminB, { title: 'B', slug: `b-${run}` });
    const detail = await release(spaceB, editorB, 'B release', [p]);
    const refused = await as(spaceB, editorB).post(`/releases/${detail.id}/publish`);
    expect([refused.status, refused.body.code]).toEqual([403, 'approval_required']);
    const later = new Date(Date.now() + 60_000).toISOString();
    expect((await as(spaceB, editorB).post(`/releases/${detail.id}/schedule`, { runAt: later })).status).toBe(403);
    expect((await as(spaceB, adminB).post(`/releases/${detail.id}/publish`)).body.status).toBe('published');
  });

  it('a scheduled release goes live when the time comes; a cancelled one does not', async () => {
    const editor = as(spaceA, editorA);
    const p = await page(spaceA, editorA, { title: 'Scheduled', slug: `scheduled-${run}` });
    const detail = await release(spaceA, editorA, 'Later', [p]);
    const later = new Date(Date.now() + 60_000).toISOString();

    const scheduled = await editor.post(`/releases/${detail.id}/schedule`, { runAt: later });
    expect(scheduled.body).toMatchObject({ status: 'scheduled' });
    expect(Date.parse(scheduled.body.scheduledAt)).toBe(Date.parse(later));
    expect((await editor.post(`/releases/${detail.id}/schedule`, { runAt: later })).body.code).toBe('already_scheduled');
    expect((await editor.post(`/releases/${detail.id}/schedule/cancel`)).body).toMatchObject({ status: 'draft', scheduledAt: null });
    await runDue(spaceA);
    expect(await live([p.id])).toHaveLength(0);

    await editor.post(`/releases/${detail.id}/schedule`, { runAt: later });
    await runDue(spaceA);
    expect((await editor.get(`/releases/${detail.id}`)).body).toMatchObject({ status: 'published', scheduledAt: null });
    expect(await live([p.id])).toHaveLength(1);
    const [action] = await db.serviceDb
      .select()
      .from(scheduledActions)
      .where(and(eq(scheduledActions.releaseId, detail.id), eq(scheduledActions.status, 'done')));
    expect(action).toBeDefined();
  });

  it('a scheduled release that cannot be published fails, with the reason on the release', async () => {
    const incomplete = await page(spaceA, editorA, { slug: `later-incomplete-${run}` });
    const detail = await release(spaceA, editorA, 'Broken', [incomplete]);
    await as(spaceA, editorA).post(`/releases/${detail.id}/schedule`, { runAt: new Date(Date.now() + 60_000).toISOString() });
    await runDue(spaceA);
    const failed: ReleaseDetail = (await as(spaceA, editorA).get(`/releases/${detail.id}`)).body;
    expect(failed).toMatchObject({ status: 'failed', scheduledAt: null });
    expect(failed.error).toContain(`later-incomplete-${run}`);
    // A failed release can be fixed and published by hand.
    await as(spaceA, editorA).patch(`/entries/${incomplete.id}`, { data: { title: 'Fixed', slug: `later-incomplete-${run}` } });
    await as(spaceA, editorA).put(`/releases/${detail.id}/items/${incomplete.id}`);
    expect((await as(spaceA, editorA).post(`/releases/${detail.id}/publish`)).body.status).toBe('published');
  });
});
