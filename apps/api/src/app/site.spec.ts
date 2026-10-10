import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { type ContentEvent, ContentEvents } from '@novan/api-content';
import { auditEvents, DbService, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import { JobWorker } from '@novan/api-jobs';
import type { CreatedApiToken, DeliveryRedirects, Entry, ImportRedirectsResult, NotFoundSummary, Redirect } from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Subscription } from 'rxjs';
import request from 'supertest';
import { AppModule } from './app.module';

// Redirects, automatic 301s and not-found reports (docs/build/14-seo-site-features.md). Needs the local Supabase
// database (`npm run db:start && npm run db:reset`); RLS for both tables is in supabase/tests/seo_site.test.sql.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
const agencyId = '00000000-0000-4000-8000-000000000001';
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

describe.skipIf(!hasDatabase)('redirects and not-found reports', () => {
  const run = Date.now();
  let app: INestApplication;
  let db: DbService;
  let spaceA: string;
  let spaceB: string;
  let editorA: string;
  let authorA: string;
  let developerB: string;
  let deliveryA: CreatedApiToken;
  let deliveryB: CreatedApiToken;
  let about: Entry;
  let subscription: Subscription;
  const events: ContentEvent[] = [];
  const last = () => events[events.length - 1];

  const server = () => app.getHttpServer();
  const manage = (spaceId: string, as: string) => ({
    get: (path: string) => request(server()).get(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }),
    post: (path: string, body: object = {}) => request(server()).post(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }).send(body),
    patch: (path: string, body: object) => request(server()).patch(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }).send(body),
    delete: (path: string) => request(server()).delete(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }),
  });
  const delivered = async (token: CreatedApiToken): Promise<DeliveryRedirects['items']> => {
    const res = await request(server()).get('/v1/delivery/redirects').auth(token.token, { type: 'bearer' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.items;
  };
  const report = (body: object, token = deliveryA) => request(server()).post('/v1/delivery/not-found').auth(token.token, { type: 'bearer' }).send(body);

  beforeAll(async () => {
    process.env['NOT_FOUND_RATE_LIMIT'] = '8';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue(cloudflare)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);
    subscription = app.get(ContentEvents).events$.subscribe((event) => events.push(event));

    const [a, b] = await db.serviceDb
      .insert(spaces)
      .values([
        { organisationId, name: 'Site A', slug: `site-a-${run}` },
        { organisationId, name: 'Site B', slug: `site-b-${run}` },
      ])
      .returning({ id: spaces.id });
    spaceA = a.id;
    spaceB = b.id;
    editorA = await jwt(novanAdminId, spaceA, 'editor');
    authorA = await jwt(clientId, spaceA, 'author');
    const developerA = await jwt(agencyId, spaceA, 'developer');
    developerB = await jwt(clientId, spaceB, 'developer');

    for (const [spaceId, as] of [
      [spaceA, developerA],
      [spaceB, developerB],
    ]) {
      const created = await manage(spaceId, as).post('/environments/main/content-types', {
        apiId: 'page',
        name: 'Page',
        kind: 'page',
        fields: [
          field('title', 'text', { required: true }),
          field('slug', 'text', { required: true }),
          field('seo', 'group', { fields: [field('noindex', 'boolean')] }),
        ],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
    }
    const env = manage(spaceA, editorA);
    const page = await env.post('/environments/main/entries', { contentType: 'page', data: { title: 'About', slug: 'about-us' } });
    about = (await env.post(`/environments/main/entries/${page.body.id}/publish`)).body;
    deliveryA = (await manage(spaceA, developerA).post('/api-tokens', { name: 'Website', scope: 'delivery' })).body;
    deliveryB = (await manage(spaceB, developerB).post('/api-tokens', { name: 'B website', scope: 'delivery' })).body;
  });

  afterAll(async () => {
    delete process.env['NOT_FOUND_RATE_LIMIT'];
    subscription?.unsubscribe();
    if (spaceA) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceA));
    if (spaceB) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceB));
    await app?.close();
  });

  describe('managing redirects', () => {
    let redirect: Redirect;

    it('an editor adds one; it is audited, announced and purged', async () => {
      const res = await manage(spaceA, editorA).post('/redirects', { fromPath: 'https://old.example.com/team/', toPath: '/about-us' });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      redirect = res.body;
      expect(redirect).toMatchObject({ fromPath: '/team', toPath: '/about-us', status: 301, automatic: false, createdBy: novanAdminId });
      expect(last()).toMatchObject({ type: 'redirects.changed', spaceId: spaceA, paths: ['/team'] });
      while (await app.get(JobWorker).runOnce('purge', { spaceId: spaceA })) {
        // until none are left
      }
      expect(cloudflare.purgeTags).toHaveBeenCalledWith(expect.arrayContaining([`redirects:${spaceA}`]));
      const [audit] = await db.serviceDb
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, spaceA), eq(auditEvents.action, 'redirect.created')));
      expect(audit.diff).toEqual({ fromPath: '/team', toPath: '/about-us', status: 301 });
    });

    it('refuses a second redirect from the same address, one hiding a published page, and loops', async () => {
      const editor = manage(spaceA, editorA);
      expect((await editor.post('/redirects', { fromPath: '/team', toPath: '/' })).body.code).toBe('redirect_exists');
      const hides = await editor.post('/redirects', { fromPath: '/about-us', toPath: '/' });
      expect(hides.status).toBe(409);
      expect(hides.body.code).toBe('redirect_hides_page');
      expect((await editor.post('/redirects', { fromPath: '/about-us/x', toPath: '/team' })).status).toBe(201);
      expect((await editor.post('/redirects', { fromPath: '/staff', toPath: '/team' })).status).toBe(201);
      const loop = await editor.post('/redirects', { fromPath: '/about-us/y', toPath: '/about-us/x' });
      expect(loop.status).toBe(201);
      const back = await editor.patch(`/redirects/${redirect.id}`, { toPath: '/staff' });
      expect(back.status).toBe(409);
      expect(back.body.code).toBe('redirect_loop');
    });

    it('validates addresses in plain language', async () => {
      const res = await manage(spaceA, editorA).post('/redirects', { fromPath: 'old', toPath: 'javascript:alert(1)' });

      expect(res.status).toBe(400);
      expect(res.body.errors.fromPath[0]).toContain('starting with /');
      expect(res.body.errors.toPath[0]).toContain('https://');
    });

    it('an editor changes and deletes one', async () => {
      const editor = manage(spaceA, editorA);
      const changed = await editor.patch(`/redirects/${redirect.id}`, { status: 302 });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(changed.body).toMatchObject({ fromPath: '/team', status: 302 });

      const staff = (await editor.get('/redirects')).body.find((r: Redirect) => r.fromPath === '/staff');
      expect((await editor.delete(`/redirects/${staff.id}`)).status).toBe(204);
      expect((await editor.get('/redirects')).body.map((r: Redirect) => r.fromPath)).not.toContain('/staff');
    });

    it('an author reads them but changes nothing', async () => {
      const author = manage(spaceA, authorA);
      expect((await author.get('/redirects')).body.length).toBeGreaterThan(0);
      const added = await author.post('/redirects', { fromPath: '/author', toPath: '/' });
      expect(added.status).toBe(403);
      expect((await author.delete(`/redirects/${redirect.id}`)).status).toBe(403);
    });

    it('imports many at once, replacing the same addresses and skipping published pages', async () => {
      const res = await manage(spaceA, editorA).post('/redirects/import', {
        redirects: [
          { fromPath: '/team', toPath: '/about-us', status: 301 },
          { fromPath: '/old-1', toPath: '/about-us' },
          { fromPath: '/old-2', toPath: 'https://elsewhere.example.com/', status: 302 },
          { fromPath: '/about-us', toPath: '/' },
        ],
      });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const result: ImportRedirectsResult = res.body;
      expect(result).toEqual({
        created: 2,
        updated: 1,
        skipped: [{ fromPath: '/about-us', message: expect.stringContaining('published page') }],
      });
      const team = (await manage(spaceA, editorA).get('/redirects')).body.find((r: Redirect) => r.fromPath === '/team');
      expect(team.status).toBe(301);
    });

    it('a member of another space cannot see or change them', async () => {
      const other = manage(spaceA, developerB);
      expect((await other.get('/redirects')).status).toBe(403);
      expect((await manage(spaceB, developerB).get('/redirects')).body).toEqual([]);
    });
  });

  describe('automatic redirects', () => {
    it('publishing a new slug redirects the old address, and the site gets it', async () => {
      const env = manage(spaceA, editorA);
      const saved = await env.patch(`/environments/main/entries/${about.id}`, { data: { title: 'About', slug: 'about' } });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect((await env.post(`/environments/main/entries/${about.id}/publish`)).status).toBe(200);

      const auto = (await env.get('/redirects')).body.find((r: Redirect) => r.fromPath === '/about-us');
      expect(auto).toMatchObject({ toPath: '/about', status: 301, automatic: true, createdBy: null });
      // Earlier redirects to the old address now go straight to the new one.
      expect((await env.get('/redirects')).body.find((r: Redirect) => r.fromPath === '/team').toPath).toBe('/about');
      expect(await delivered(deliveryA)).toContainEqual({ from: '/about-us', to: '/about', status: 301 });
    });

    it('moving a published page redirects too, and announces the change', async () => {
      const env = manage(spaceA, editorA);
      const folder = await env.post('/environments/main/folders', { name: 'Company', slug: 'company' });
      const moved = await env.post(`/environments/main/entries/${about.id}/move`, { folderId: folder.body.id });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);

      expect(last()).toMatchObject({ type: 'paths.changed', entryIds: [about.id], paths: ['/about', '/company/about'] });
      expect(await delivered(deliveryA)).toContainEqual({ from: '/about', to: '/company/about', status: 301 });

      const renamed = await env.patch(`/environments/main/folders/${folder.body.id}`, { slug: 'us' });
      expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
      expect(last()).toMatchObject({ type: 'paths.changed', paths: ['/company/about', '/us/about'] });
      const redirects = await delivered(deliveryA);
      expect(redirects).toContainEqual({ from: '/company/about', to: '/us/about', status: 301 });
      expect(redirects).toContainEqual({ from: '/about-us', to: '/us/about', status: 301 });
    });
  });

  describe('the Delivery API', () => {
    it('serves the redirects of the token\'s space only, cached until they change', async () => {
      const res = await request(server()).get('/v1/delivery/redirects').auth(deliveryA.token, { type: 'bearer' });

      expect(res.headers['cache-control']).toContain('s-maxage=31536000');
      expect(res.headers['cache-tag']).toContain(`redirects:${spaceA}`);
      expect(await delivered(deliveryB)).toEqual([]);
    });

    it('records misses once per address and day, counting visits; addresses that redirect are left out', async () => {
      expect((await report({ path: '/gone?utm=x', referrer: 'https://search.example.com/' })).status).toBe(202);
      expect((await report({ path: '/gone/' })).status).toBe(202);
      expect((await report({ path: '/old-1' })).status).toBe(202);
      expect((await report({ path: '/b-only' }, deliveryB)).status).toBe(202);
      expect((await report({ path: 'no-slash' })).status).toBe(400);

      const res = await manage(spaceA, authorA).get('/not-found');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows: NotFoundSummary[] = res.body;
      expect(rows).toEqual([
        { path: '/gone', hits: 2, days: 1, lastSeenAt: expect.any(String), lastReferrer: 'https://search.example.com/' },
      ]);
    });

    it('limits how often a site reports misses', async () => {
      // Four sent with A's token above (the malformed one counts too); the limit is eight a minute in this test.
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await report({ path: `/burst-${i}` })).status);
      expect(statuses).toEqual([202, 202, 202, 202, 429]);
    });

    it('leaves pages hidden from search engines out of the sitemap', async () => {
      const env = manage(spaceA, editorA);
      const hidden = await env.post('/environments/main/entries', { contentType: 'page', data: { title: 'Thanks', slug: 'thanks', seo: { noindex: true } } });
      expect((await env.post(`/environments/main/entries/${hidden.body.id}/publish`)).status).toBe(200);

      const sitemap = await request(server()).get('/v1/delivery/sitemap').auth(deliveryA.token, { type: 'bearer' });
      const paths = sitemap.body.items.map((item: { path: string }) => item.path);
      expect(paths).toContain('/us/about');
      expect(paths).not.toContain('/thanks');
    });

    it('does not take preview tokens for reports', async () => {
      const res = await request(server()).post('/v1/delivery/not-found').auth(`nv_pre_${'a'.repeat(43)}`, { type: 'bearer' }).send({ path: '/x' });
      expect(res.status).toBe(403);
    });
  });
});
