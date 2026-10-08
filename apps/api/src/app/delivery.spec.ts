import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { assets, auditEvents, DbService, publishedContent, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import type { ApiToken, CreatedApiToken, DeliveryEntriesPage, DeliveryEntry, Entry } from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// The DB-backed block needs the local Supabase database (`npm run db:start && npm run db:reset`).
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';
process.env['PUBLIC_API_URL'] = 'https://api.novan.test';

const secret = 'test-secret-with-at-least-32-characters!';

// Seeded users (supabase/seed.sql). Tokens carry the role claims RLS reads.
const agencyId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const novanAdminId = '00000000-0000-4000-8000-000000000003';
const organisationId = '00000000-0000-4000-8000-000000000100';

function jwt(sub: string, spaces: { id: string; role: string }[]): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: 'aal1', spaces, agency_staff: false })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));
}

const field = (apiId: string, type: string, extra: object = {}) => ({ id: apiId, apiId, label: apiId, type, ...extra });

/** What the Cloudflare client was asked to purge. */
const cloudflare = {
  enabled: true,
  purgeTags: vi.fn<(tags: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
  purgeUrls: vi.fn<(urls: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
};

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JWT_VERIFIER_CONFIG)
    .useValue({ secret })
    .overrideProvider(CloudflareClient)
    .useValue(cloudflare)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('delivery and preview APIs', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The functional tests send many requests a second; the limits have their own block below.
    process.env['DELIVERY_RATE_LIMIT'] = '100000';
    process.env['PREVIEW_RATE_LIMIT'] = '100000';
    app = await createApp();
  });

  afterAll(async () => {
    delete process.env['DELIVERY_RATE_LIMIT'];
    delete process.env['PREVIEW_RATE_LIMIT'];
    await app.close();
  });

  const server = () => app.getHttpServer();

  // These are refused before the database is asked, so they run without one (CI's unit test job).
  describe('without a usable token', () => {
    it.each([
      ['no token', 401, 'missing_token', undefined],
      ['a Supabase session', 401, 'invalid_token', 'eyJhbGciOiJIUzI1NiJ9.e30.sig'],
      ['a preview token', 403, 'wrong_token_scope', `nv_pre_${'a'.repeat(43)}`],
    ])('answers %s with %i, and nothing is cached', async (_, status, code, token) => {
      const req = request(server()).get('/v1/delivery/pages?path=/');
      const res = await (token ? req.auth(token, { type: 'bearer' }) : req);
      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('does not take a delivery token on the Preview API', async () => {
      const res = await request(server()).get('/v1/preview/sitemap').auth(`nv_del_${'a'.repeat(43)}`, { type: 'bearer' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('wrong_token_scope');
    });

    it('publishes an OpenAPI document of the management, delivery and preview APIs', async () => {
      const res = await request(server()).get('/v1/docs');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      const paths = res.body.paths as Record<string, Record<string, { parameters?: { name: string }[]; requestBody?: unknown; security?: unknown }>>;
      expect(paths['/v1/delivery/entries'].get.parameters?.map((p) => p.name)).toEqual(
        expect.arrayContaining(['type', 'sort', 'limit', 'cursor', 'include', 'select', 'locale']),
      );
      expect(paths['/v1/delivery/entries'].get.security).toEqual([{ deliveryToken: [] }]);
      expect(paths['/v1/preview/pages'].get.security).toEqual([{ previewToken: [] }]);
      expect(paths['/v1/management/spaces/{spaceId}/api-tokens'].post.requestBody).toBeDefined();
      expect(paths['/v1/management/spaces/{spaceId}/environments/{env}/content-types'].post.requestBody).toBeDefined();
      // Every $ref resolves within the document.
      const refs = JSON.stringify(res.body).match(/"\$ref":"#\/components\/schemas\/[^"]+"/g) ?? [];
      for (const ref of refs) expect(res.body.components.schemas[ref.split('/').pop()?.slice(0, -1) ?? '']).toBeDefined();
    });
  });

  describe.skipIf(!hasDatabase)('with the database', () => {
    const run = Date.now();
    let db: DbService;
    let spaceA: string;
    let spaceB: string;
    let developerA: string;
    let editorA: string;
    let developerB: string;
    let deliveryA: CreatedApiToken;
    let previewA: CreatedApiToken;
    let deliveryB: CreatedApiToken;

    // Space A's content.
    let home: Entry;
    let about: Entry;
    let blogPost: Entry;
    let draftOnly: Entry;
    let authorA: Entry;
    let authorB: Entry;
    let unpublishedAuthor: Entry;
    let settings: Entry;
    const posts: Entry[] = [];
    const photo = randomUUID();
    // Space B's.
    let secretB: Entry;
    const photoB = randomUUID();

    const manage = (spaceId: string, as: string) => ({
      get: (path: string) => request(server()).get(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }),
      post: (path: string, body: object = {}) =>
        request(server()).post(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }).send(body),
      patch: (path: string, body: object) =>
        request(server()).patch(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }).send(body),
    });
    const read = (path: string, token: CreatedApiToken) => request(server()).get(path).auth(token.token, { type: 'bearer' });
    const delivery = (path: string, token = deliveryA) => read(`/v1/delivery${path}`, token);
    const preview = (path: string, token = previewA) => read(`/v1/preview${path}`, token);

    /** Creates and publishes an entry as A's editor (or B's developer). */
    async function entry(spaceId: string, as: string, body: object, publish = true): Promise<Entry> {
      const env = manage(spaceId, as);
      const created = await env.post('/environments/main/entries', body);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      if (!publish) return created.body;
      const published = await env.post(`/environments/main/entries/${created.body.id}/publish`);
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      return published.body;
    }

    async function model(spaceId: string, as: string): Promise<void> {
      const env = manage(spaceId, as);
      const ok = (res: request.Response) => expect(res.status, JSON.stringify(res.body)).toBe(201);
      ok(await env.post('/environments/main/block-types', { apiId: 'card', name: 'Card', fields: [field('heading', 'text'), field('link', 'reference')] }));
      ok(
        await env.post('/environments/main/content-types', {
          apiId: 'page',
          name: 'Page',
          kind: 'page',
          fields: [
            field('title', 'text', { required: true }),
            field('slug', 'text', { required: true }),
            field('hero', 'media'),
            field('related', 'reference', { multiple: true }),
            field('cta', 'link'),
            field('body', 'blocks', { allowedBlocks: ['card'] }),
          ],
        }),
      );
      ok(await env.post('/environments/main/content-types', { apiId: 'author', name: 'Author', kind: 'entry', fields: [field('name', 'text'), field('friend', 'reference')] }));
      ok(
        await env.post('/environments/main/content-types', {
          apiId: 'post',
          name: 'Post',
          kind: 'entry',
          fields: [
            field('title', 'text'),
            field('rating', 'number'),
            field('category', 'select', { options: [{ value: 'news', label: 'News' }, { value: 'guide', label: 'Guide' }] }),
            field('tags', 'select', { multiple: true, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
            field('publishedOn', 'date'),
            field('author', 'reference'),
          ],
        }),
      );
      ok(await env.post('/environments/main/content-types', { apiId: 'settings', name: 'Settings', kind: 'singleton', fields: [field('siteName', 'text')] }));
    }

    beforeAll(async () => {
      db = app.get(DbService);
      const [a, b] = await db.serviceDb
        .insert(spaces)
        .values([
          { organisationId, name: 'Delivery A', slug: `delivery-a-${run}` },
          { organisationId, name: 'Delivery B', slug: `delivery-b-${run}` },
        ])
        .returning({ id: spaces.id });
      spaceA = a.id;
      spaceB = b.id;
      developerA = await jwt(agencyId, [{ id: spaceA, role: 'developer' }]);
      editorA = await jwt(novanAdminId, [{ id: spaceA, role: 'editor' }]);
      developerB = await jwt(clientId, [{ id: spaceB, role: 'developer' }]);

      await model(spaceA, developerA);
      await model(spaceB, developerB);
      await db.serviceDb.insert(assets).values([
        { id: photo, spaceId: spaceA, path: `spaces/${spaceA}/${photo}/sunrise.jpg`, filename: 'sunrise.jpg', mime: 'image/jpeg', sizeBytes: 100, width: 1200, height: 800, alt: 'Sunrise', focalX: 0.5, focalY: 0.25 },
        { id: photoB, spaceId: spaceB, path: `spaces/${spaceB}/${photoB}/private.jpg`, filename: 'private.jpg', mime: 'image/jpeg', sizeBytes: 100, width: 10, height: 10, alt: 'B' },
      ]);

      // Space A: authors that reference each other, a home page, an about page, a blog post in a folder,
      // a page never published and five posts.
      const editA = manage(spaceA, editorA);
      authorA = await entry(spaceA, editorA, { contentType: 'author', slug: 'ada', data: { name: 'Ada' } }, false);
      authorB = await entry(spaceA, editorA, { contentType: 'author', slug: 'bo', data: { name: 'Bo', friend: authorA.id } });
      await editA.patch(`/environments/main/entries/${authorA.id}`, { data: { name: 'Ada', friend: authorB.id } });
      await editA.post(`/environments/main/entries/${authorA.id}/publish`);
      unpublishedAuthor = await entry(spaceA, editorA, { contentType: 'author', slug: 'cy', data: { name: 'Cy' } }, false);

      about = await entry(spaceA, editorA, { contentType: 'page', data: { title: 'About', slug: 'about' } });
      home = await entry(spaceA, editorA, {
        contentType: 'page',
        data: {
          title: 'Welcome',
          slug: 'home',
          hero: { assetId: photo, alt: 'Morning over the bay' },
          related: [authorA.id, unpublishedAuthor.id],
          cta: { type: 'internal', entryId: about.id, text: 'About us' },
          body: [{ _uid: randomUUID(), _block: 'card', heading: 'Meet Bo', link: authorB.id }],
        },
      });
      const folder = await editA.post('/environments/main/folders', { name: 'Blog', slug: 'blog' });
      blogPost = await entry(spaceA, editorA, { contentType: 'page', folderId: folder.body.id, data: { title: 'First', slug: 'first' } });
      draftOnly = await entry(spaceA, editorA, { contentType: 'page', data: { title: 'Coming soon', slug: 'soon' } }, false);
      settings = await entry(spaceA, editorA, { contentType: 'settings', slug: 'settings', data: { siteName: 'Site A' } });
      const postData = [
        { title: 'One', rating: 1, category: 'news', tags: ['a'], publishedOn: '2026-01-01' },
        { title: 'Two', rating: 2, category: 'guide', tags: ['b'], publishedOn: '2026-02-01' },
        { title: 'Three', rating: 3, category: 'news', tags: ['a', 'b'], publishedOn: '2026-03-01' },
        { title: 'Four', rating: 4, category: 'guide', tags: [], publishedOn: '2026-04-01', author: authorB.id },
        { title: 'Five', rating: 5, category: 'news', publishedOn: '2026-05-01' },
        { title: 'No rating', category: 'news' },
      ];
      for (const [i, data] of postData.entries()) posts.push(await entry(spaceA, editorA, { contentType: 'post', slug: `post-${i}`, data }));

      // Space B: a page A must never see.
      secretB = await entry(spaceB, developerB, {
        contentType: 'page',
        data: { title: 'B only', slug: 'secret', hero: { assetId: photoB } },
      });
      await entry(spaceB, developerB, { contentType: 'settings', slug: 'settings', data: { siteName: 'Site B' } });

      const tokensA = manage(spaceA, developerA);
      deliveryA = (await tokensA.post('/api-tokens', { name: 'Website', scope: 'delivery' })).body;
      previewA = (await tokensA.post('/api-tokens', { name: 'Previews', scope: 'preview' })).body;
      deliveryB = (await manage(spaceB, developerB).post('/api-tokens', { name: 'B website', scope: 'delivery' })).body;
    });

    afterAll(async () => {
      if (spaceA) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceA));
      if (spaceB) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceB));
    });

    describe('API tokens', () => {
      it('answers a well-formed but unknown token with 401, and nothing is cached', async () => {
        const res = await request(server()).get('/v1/delivery/pages?path=/').auth(`nv_del_${'a'.repeat(43)}`, { type: 'bearer' });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('invalid_token');
        expect(res.headers['cache-control']).toBe('no-store');
      });

      it('a developer creates tokens; the secret is shown once and only its hash is kept', async () => {
        expect(deliveryA).toMatchObject({ name: 'Website', scope: 'delivery', environment: 'main', revokedAt: null, lastUsedAt: null });
        expect(deliveryA.token).toMatch(/^nv_del_[A-Za-z0-9_-]{43}$/);
        expect(deliveryA.hint).toBe(`nv_del_…${deliveryA.token.slice(-4)}`);
        expect(previewA.token).toMatch(/^nv_pre_/);

        const list: ApiToken[] = (await manage(spaceA, developerA).get('/api-tokens')).body;
        expect(list.map((t) => t.id)).toEqual([previewA.id, deliveryA.id]);
        expect(JSON.stringify(list)).not.toContain(deliveryA.token);
        const audit = await db.serviceDb
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(and(eq(auditEvents.spaceId, spaceA), eq(auditEvents.targetId, deliveryA.id)));
        expect(audit.map((a) => a.action)).toEqual(['api_token.created']);
      });

      it('editors cannot see or create tokens', async () => {
        expect((await manage(spaceA, editorA).get('/api-tokens')).status).toBe(403);
        expect((await manage(spaceA, editorA).post('/api-tokens', { name: 'x', scope: 'delivery' })).body.code).toBe('insufficient_role');
      });

      it('refuses an environment the space does not have', async () => {
        const res = await manage(spaceA, developerA).post('/api-tokens', { name: 'x', scope: 'delivery', environment: 'staging' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('environment_not_found');
      });

      it('a revoked token stops working at once, and its cached responses are purged', async () => {
        const tokens = manage(spaceA, developerA);
        const temporary: CreatedApiToken = (await tokens.post('/api-tokens', { name: 'Temporary', scope: 'delivery' })).body;
        expect((await delivery('/sitemap', temporary)).status).toBe(200);

        cloudflare.purgeTags.mockClear();
        const revoked = await tokens.post(`/api-tokens/${temporary.id}/revoke`);
        expect(revoked.status).toBe(200);
        expect(revoked.body.revokedAt).not.toBeNull();
        expect((await delivery('/sitemap', temporary)).status).toBe(401);
        expect(cloudflare.purgeTags).toHaveBeenCalledWith([`token:${temporary.id}`]);
        expect((await tokens.post(`/api-tokens/${temporary.id}/revoke`)).body.code).toBe('api_token_revoked');
      });
    });

    describe('pages', () => {
      it('finds a page by path, expanding files, references and internal links', async () => {
        const res = await delivery('/pages?path=/');
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const page: DeliveryEntry = res.body;
        expect(page).toMatchObject({ id: home.id, contentType: 'page', path: '/', locale: 'en-GB' });
        expect(page.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+00:00$/);
        expect(page.data['hero']).toEqual({
          id: photo,
          url: `https://api.novan.test/v1/assets/${photo}/sunrise.jpg?v=1`,
          filename: 'sunrise.jpg',
          mime: 'image/jpeg',
          width: 1200,
          height: 800,
          alt: 'Morning over the bay',
          focal: { x: 0.5, y: 0.25 },
        });
        // The unpublished author is left out; the published one is expanded one level.
        const related = page.data['related'] as DeliveryEntry[];
        expect(related.map((r) => r.id)).toEqual([authorA.id]);
        expect(related[0].data).toEqual({ name: 'Ada', friend: { id: authorB.id } });
        expect(page.data['cta']).toEqual({ type: 'internal', entryId: about.id, text: 'About us', path: '/about' });
        expect((page.data['body'] as { link: DeliveryEntry }[])[0].link).toMatchObject({ id: authorB.id, data: { name: 'Bo' } });
      });

      it('finds pages in folders, ignores a trailing slash, and answers 404 for other locales', async () => {
        expect((await delivery('/pages?path=/blog/first/')).body).toMatchObject({ id: blogPost.id, path: '/blog/first' });
        const other = await delivery('/pages?path=/about&locale=fr-FR');
        expect(other.status).toBe(404);
        expect(other.body.code).toBe('page_not_found');
        expect(other.headers['cache-control']).toBe('no-store');
      });

      it('only finds pages, not other kinds of entry', async () => {
        expect((await delivery('/pages?path=/ada')).status).toBe(404);
      });

      it('expands references to the requested depth and stops at loops', async () => {
        const at = async (include: number) => ((await delivery(`/pages?path=/&include=${include}`)).body as DeliveryEntry).data['related'];
        expect(await at(0)).toEqual([{ id: authorA.id }, { id: unpublishedAuthor.id }]);
        const deep = (await at(3)) as DeliveryEntry[];
        const friend = deep[0].data['friend'] as DeliveryEntry;
        expect(friend).toMatchObject({ id: authorB.id, data: { name: 'Bo' } });
        // Bo's friend is Ada, who is already being expanded.
        expect(friend.data['friend']).toEqual({ id: authorA.id });
      });

      it('returns only the selected fields', async () => {
        const res = await delivery('/pages?path=/&select=fields.title,fields.cta');
        expect(Object.keys(res.body.data)).toEqual(['title', 'cta']);
      });
    });

    describe('delivery never reads drafts', () => {
      it('a page that was never published is not delivered, but can be previewed', async () => {
        expect((await delivery('/pages?path=/soon')).status).toBe(404);
        expect((await delivery(`/entries/${draftOnly.id}`)).status).toBe(404);
        const previewed = await preview('/pages?path=/soon');
        expect(previewed.status).toBe(200);
        expect(previewed.body.data.title).toBe('Coming soon');
      });

      it('an edited page keeps its published version until it is published again', async () => {
        await manage(spaceA, editorA).patch(`/environments/main/entries/${about.id}`, { data: { title: 'About us (draft)', slug: 'about' } });
        expect((await delivery('/pages?path=/about')).body.data.title).toBe('About');
        expect((await preview('/pages?path=/about')).body.data.title).toBe('About us (draft)');
        const list: DeliveryEntriesPage = (await delivery('/entries?type=page&select=fields.title')).body;
        expect(list.items.map((item) => item.data['title'])).not.toContain('About us (draft)');
      });

      it('preview leaves out references to entries in the bin', async () => {
        const previewed: DeliveryEntry = (await preview('/pages?path=/')).body;
        expect((previewed.data['related'] as DeliveryEntry[]).map((r) => r.id)).toEqual([authorA.id, unpublishedAuthor.id]);
      });
    });

    describe('entries', () => {
      const ids = (page: DeliveryEntriesPage) => page.items.map((item) => item.id);
      const titles = (page: DeliveryEntriesPage) => page.items.map((item) => item.data['title']);

      it('filters by type and fields', async () => {
        const list = async (query: string) => (await delivery(`/entries?type=post&sort=fields.rating&${query}`)).body as DeliveryEntriesPage;
        expect(titles(await list('fields.rating[gt]=2'))).toEqual(['Three', 'Four', 'Five']);
        expect(titles(await list('fields.rating[gt]=1&fields.rating[lt]=4'))).toEqual(['Two', 'Three']);
        expect(titles(await list('fields.category=guide'))).toEqual(['Two', 'Four']);
        expect(titles(await list('fields.title[in]=One,Five'))).toEqual(['One', 'Five']);
        expect(titles(await list('fields.tags[eq]=b'))).toEqual(['Two', 'Three']);
        expect(titles(await list('fields.tags[in]=a,b'))).toEqual(['One', 'Two', 'Three']);
        expect(titles(await list('fields.publishedOn[lt]=2026-03-01'))).toEqual(['One', 'Two']);
        expect(titles(await list(`fields.author=${authorB.id}`))).toEqual(['Four']);
      });

      it('explains filters it cannot apply', async () => {
        const problem = async (query: string) => (await delivery(`/entries?${query}`)).body.code;
        expect(await problem('type=post&fields.rating[gt]=lots')).toBe('invalid_filter');
        expect(await problem('type=post&fields.colour=red')).toBe('unknown_field');
        expect(await problem('type=page&fields.body[eq]=x')).toBe('field_not_filterable');
        expect(await problem('type=post&fields.category[lt]=news')).toBe('invalid_filter');
        expect(await problem('type=post&fields.tags[gt]=a')).toBe('invalid_filter');
        expect(await problem('type=missing')).toBe('content_type_not_found');
        expect(await problem('fields.title=x')).toBe('validation_failed');
        expect(await problem("type=post&fields.title[eq]=x'%3B drop table entries%3B--")).toBeUndefined();
      });

      it('sorts, with empty values last either way', async () => {
        const sorted = async (sort: string) => titles((await delivery(`/entries?type=post&sort=${sort}`)).body);
        expect(await sorted('fields.rating')).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'No rating']);
        expect(await sorted('-fields.rating')).toEqual(['Five', 'Four', 'Three', 'Two', 'One', 'No rating']);
        expect(await sorted('-updatedAt')).toEqual(['No rating', 'Five', 'Four', 'Three', 'Two', 'One']);
      });

      it('pages through results with a cursor, without gaps or repeats', async () => {
        for (const sort of ['fields.rating', '-fields.rating', '-updatedAt', 'path', 'fields.title']) {
          const all: string[] = [];
          let cursor: string | null = null;
          let pages = 0;
          do {
            const res = await delivery(`/entries?type=post&sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
            expect(res.status, JSON.stringify(res.body)).toBe(200);
            all.push(...ids(res.body));
            cursor = res.body.nextCursor;
            pages++;
          } while (cursor && pages < 10);
          const everything = ids((await delivery(`/entries?type=post&sort=${sort}&limit=100`)).body);
          expect(all, sort).toEqual(everything);
          expect(everything).toHaveLength(6);
        }
      });

      it('refuses a cursor from another sort, or made up', async () => {
        const first = (await delivery('/entries?type=post&sort=fields.rating&limit=2')).body as DeliveryEntriesPage;
        expect((await delivery(`/entries?type=post&sort=path&cursor=${first.nextCursor}`)).body.code).toBe('invalid_cursor');
        expect((await delivery('/entries?cursor=bm90LWpzb24')).body.code).toBe('invalid_cursor');
      });

      it('gets one entry by id, and lists every type without a filter', async () => {
        expect((await delivery(`/entries/${posts[0].id}`)).body).toMatchObject({ id: posts[0].id, contentType: 'post' });
        const all = (await delivery('/entries?limit=100')).body as DeliveryEntriesPage;
        expect(new Set(all.items.map((item) => item.contentType))).toEqual(new Set(['page', 'post', 'author', 'settings']));
      });
    });

    describe('singletons and the sitemap', () => {
      it('delivers a singleton by its api id', async () => {
        const res = await delivery('/singletons/settings');
        expect(res.body).toMatchObject({ id: settings.id, data: { siteName: 'Site A' } });
        expect((await delivery('/singletons/page')).body.code).toBe('singleton_not_found');
      });

      it('lists published pages only, with the home page at /', async () => {
        const res = await delivery('/sitemap');
        expect(res.body.items.map((item: { path: string }) => item.path)).toEqual(['/about', '/blog/first', '/']);
        expect(res.headers['cache-tag']).toContain(`sitemap:`);
        expect((await preview('/sitemap')).body.items.map((item: { path: string }) => item.path)).toContain('/soon');
      });
    });

    describe('caching', () => {
      it('delivery responses are cached by the CDN under their tags, with an ETag', async () => {
        const res = await delivery('/pages?path=/');
        expect(res.headers['cache-control']).toBe('public, max-age=0, s-maxage=31536000, stale-while-revalidate=60');
        expect(res.headers['vary']).toContain('Authorization');
        const tags = String(res.headers['cache-tag']).split(',');
        expect(tags).toEqual(
          expect.arrayContaining([`token:${deliveryA.id}`, `space:${spaceA}`, `entry:${home.id}`, `entry:${authorA.id}`, `entry:${authorB.id}`, `asset:${photo}`]),
        );
        expect(res.headers['etag']).toBeTruthy();
        const again = await delivery('/pages?path=/').set('If-None-Match', res.headers['etag']);
        expect(again.status).toBe(304);
      });

      it('lists are tagged by type within the environment, or as unfiltered lists', async () => {
        const [row] = await db.serviceDb.select({ env: publishedContent.environmentId }).from(publishedContent).where(eq(publishedContent.entryId, home.id));
        expect(String((await delivery('/entries?type=post')).headers['cache-tag'])).toContain(`type:${row.env}:post`);
        expect(String((await delivery('/entries')).headers['cache-tag'])).toContain(`entries:${row.env}`);
        expect(String((await delivery('/singletons/settings')).headers['cache-tag'])).toContain(`type:${row.env}:settings`);
      });

      it('preview responses are never cached', async () => {
        const res = await preview('/pages?path=/');
        expect(res.headers['cache-control']).toBe('private, no-store');
        expect(res.headers['cache-tag']).toBeUndefined();
      });

      it('publishing purges the entry, its type, the lists and the sitemap', async () => {
        cloudflare.purgeTags.mockClear();
        const editA = manage(spaceA, editorA);
        await editA.patch(`/environments/main/entries/${about.id}`, { data: { title: 'About us', slug: 'about' } });
        await editA.post(`/environments/main/entries/${about.id}/publish`);
        const [row] = await db.serviceDb.select({ env: publishedContent.environmentId }).from(publishedContent).where(eq(publishedContent.entryId, about.id));
        await vi.waitFor(() => expect(cloudflare.purgeTags).toHaveBeenCalled());
        expect(cloudflare.purgeTags.mock.calls[0][0]).toEqual([
          `entry:${about.id}`,
          `type:${row.env}:page`,
          `entries:${row.env}`,
          `sitemap:${row.env}`,
          `overflow:${spaceA}`,
        ]);
        expect((await delivery('/pages?path=/about')).body.data.title).toBe('About us');
      });
    });

    describe('signed preview tokens (visual editor)', () => {
      const session = (signed: string | null, token = previewA) => {
        const req = preview('/session', token);
        return signed === null ? req : req.set('X-Novan-Preview', signed);
      };

      it('any member who can read a page gets one, and the Preview API exchanges it', async () => {
        const viewerA = await jwt(clientId, [{ id: spaceA, role: 'viewer' }]);
        const issued = await manage(spaceA, viewerA).post(`/environments/main/entries/${draftOnly.id}/preview-token`);
        expect(issued.status, JSON.stringify(issued.body)).toBe(201);
        const expiresIn = Date.parse(issued.body.expiresAt) - Date.now();
        expect(expiresIn).toBeGreaterThan(14 * 60_000);
        expect(expiresIn).toBeLessThanOrEqual(15 * 60_000);

        const res = await session(issued.body.token);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body).toEqual({ entryId: draftOnly.id, expiresAt: issued.body.expiresAt, adminOrigin: 'http://localhost:4200' });
        expect(res.headers['cache-control']).toBe('private, no-store');
      });

      it('refuses pages in another space, in the bin or that do not exist', async () => {
        expect((await manage(spaceA, developerA).post(`/environments/main/entries/${secretB.id}/preview-token`)).status).toBe(404);
        expect((await manage(spaceA, developerA).post(`/environments/main/entries/${randomUUID()}/preview-token`)).status).toBe(404);
        expect((await manage(spaceB, developerA).post(`/environments/main/entries/${secretB.id}/preview-token`)).status).toBe(403);
        expect((await manage(spaceA, developerA).post(`/environments/staging/entries/${home.id}/preview-token`)).status).toBe(404);
      });

      it('a site cannot use it without the space’s preview token, or with another space’s', async () => {
        const issued = (await manage(spaceA, editorA).post(`/environments/main/entries/${home.id}/preview-token`)).body;
        expect((await request(server()).get('/v1/preview/session').set('X-Novan-Preview', issued.token)).status).toBe(401);
        expect((await session(issued.token, deliveryA)).status).toBe(403);

        const previewB: CreatedApiToken = (await manage(spaceB, developerB).post('/api-tokens', { name: 'B previews', scope: 'preview' })).body;
        const crossed = await session(issued.token, previewB);
        expect(crossed.status).toBe(403);
        expect(crossed.body.code).toBe('preview_not_allowed');
        expect(crossed.headers['cache-control']).toBe('no-store');
      });

      it('refuses missing, altered and made-up signed tokens', async () => {
        const issued = (await manage(spaceA, editorA).post(`/environments/main/entries/${home.id}/preview-token`)).body;
        const [payload, signature] = (issued.token as string).split('.');
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const altered = Buffer.from(JSON.stringify({ ...claims, e: secretB.id })).toString('base64url');
        for (const signed of [null, '', 'nonsense', `${altered}.${signature}`, `${payload}.${'A'.repeat(signature.length)}`]) {
          const res = await session(signed);
          expect(res.status, String(signed)).toBe(403);
          expect(res.body.code).toBe('preview_not_allowed');
        }
      });
    });

    describe('preview data (visual editor)', () => {
      const render = (as: string, entryId: string, data: object, spaceId = spaceA) =>
        manage(spaceId, as).post(`/environments/main/entries/${entryId}/preview-data`, { data });

      it('returns unsaved data as sites get it, without hidden blocks, and saves nothing', async () => {
        const viewerA = await jwt(clientId, [{ id: spaceA, role: 'viewer' }]);
        const shown = randomUUID();
        const res = await render(viewerA, home.id, {
          title: 'Not saved',
          slug: 'home',
          hero: { assetId: photo },
          related: [authorB.id],
          cta: { type: 'internal', entryId: about.id, text: 'About' },
          body: [
            { _uid: shown, _block: 'card', heading: 'Shown' },
            { _uid: randomUUID(), _block: 'card', heading: 'Hidden', _hidden: true },
          ],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const page: DeliveryEntry = res.body;
        expect(page).toMatchObject({ id: home.id, contentType: 'page', path: '/', locale: 'en-GB' });
        expect(page.data['title']).toBe('Not saved');
        // Preview has no image route, so files get signed Storage addresses (none locally for a made-up file).
        expect(page.data['hero']).toMatchObject({ id: photo, filename: 'sunrise.jpg', alt: 'Sunrise' });
        expect((page.data['related'] as DeliveryEntry[])[0]).toMatchObject({ id: authorB.id, data: { name: 'Bo' } });
        expect(page.data['cta']).toEqual({ type: 'internal', entryId: about.id, text: 'About', path: '/about' });
        expect(page.data['body']).toEqual([{ _uid: shown, _block: 'card', heading: 'Shown' }]);

        expect((await manage(spaceA, editorA).get(`/environments/main/entries/${home.id}`)).body.data.title).toBe('Welcome');
      });

      it('never shows another space’s files or entries', async () => {
        const res = await render(editorA, home.id, { title: 'x', slug: 'home', hero: { assetId: photoB }, related: [secretB.id] });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.hero).toBeNull();
        expect(res.body.data.related).toEqual([]);
      });

      it('checks the data as a draft', async () => {
        const res = await render(editorA, home.id, { title: 5, cta: { type: 'external', url: 'javascript:alert(1)' } });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('entry_invalid');
        expect(Object.keys(res.body.errors).sort()).toEqual(['cta.url', 'title']);
      });

      it('refuses pages in another space or that do not exist', async () => {
        expect((await render(developerA, secretB.id, {})).status).toBe(404);
        expect((await render(developerA, randomUUID(), {})).status).toBe(404);
        expect((await render(developerA, secretB.id, {}, spaceB)).status).toBe(403);
      });
    });

    describe('a token for space A never returns space B content', () => {
      it('not by path, id, type or singleton', async () => {
        expect((await delivery('/pages?path=/secret')).status).toBe(404);
        expect((await delivery(`/entries/${secretB.id}`)).status).toBe(404);
        expect((await preview(`/entries/${secretB.id}`)).status).toBe(404);
        expect((await delivery('/singletons/settings')).body.data.siteName).toBe('Site A');
        // B's own token does find it.
        expect((await delivery('/pages?path=/secret', deliveryB)).body.id).toBe(secretB.id);
      });

      it('not with crafted filters or cursors', async () => {
        const list = async (query: string) => ((await delivery(`/entries?${query}`)).body as DeliveryEntriesPage).items;
        expect(await list('type=page&fields.title=B only')).toEqual([]);
        expect(await list(`type=page&fields.title[in]=B only,About us`)).toHaveLength(1);
        const cursor = Buffer.from(JSON.stringify({ s: '-updatedAt', v: null, id: secretB.id })).toString('base64url');
        for (const item of await list(`limit=100&cursor=${cursor}`)) expect(item.id).not.toBe(secretB.id);
        const all = await list('limit=100');
        expect(all.map((item) => item.id)).not.toContain(secretB.id);
        expect(JSON.stringify(all)).not.toContain('B only');
      });

      it('not through references or files that point into B', async () => {
        // Published data is validated, so this can only be planted in the database.
        const [row] = await db.serviceDb.select({ data: publishedContent.data }).from(publishedContent).where(eq(publishedContent.entryId, blogPost.id));
        await db.serviceDb
          .update(publishedContent)
          .set({ data: { ...(row.data as object), related: [secretB.id], hero: { assetId: photoB }, cta: { type: 'internal', entryId: secretB.id } } })
          .where(eq(publishedContent.entryId, blogPost.id));
        const res = await delivery('/pages?path=/blog/first&include=3');
        expect(res.body.data).toMatchObject({ related: [], hero: null, cta: { type: 'internal', entryId: secretB.id, path: null } });
        expect(JSON.stringify(res.body)).not.toMatch(/B only|private\.jpg/);
        await db.serviceDb.update(publishedContent).set({ data: row.data }).where(eq(publishedContent.entryId, blogPost.id));
      });

      it('not in the sitemap', async () => {
        const paths = (await delivery('/sitemap')).body.items.map((item: { path: string }) => item.path);
        expect(paths).not.toContain('/secret');
      });
    });
  });
});

describe.skipIf(!hasDatabase)('rate limits per token', () => {
  let app: INestApplication;
  let db: DbService;
  let spaceId: string;

  beforeAll(async () => {
    app = await createApp();
    db = app.get(DbService);
    const [space] = await db.serviceDb.insert(spaces).values({ organisationId, name: 'Limits', slug: `limits-${Date.now()}` }).returning({ id: spaces.id });
    spaceId = space.id;
  });

  afterAll(async () => {
    if (spaceId) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceId));
    await app.close();
  });

  it.each([
    ['delivery', 50],
    ['preview', 10],
  ] as const)('allows %s tokens %i requests a second, then answers 429 with Retry-After', async (scope, limit) => {
    const developer = await jwt(agencyId, [{ id: spaceId, role: 'developer' }]);
    const created = await request(app.getHttpServer())
      .post(`/v1/management/spaces/${spaceId}/api-tokens`)
      .auth(developer, { type: 'bearer' })
      .send({ name: scope, scope });
    const token: string = created.body.token;
    const responses = await Promise.all(
      Array.from({ length: limit + 5 }, () => request(app.getHttpServer()).get(`/v1/${scope}/sitemap`).auth(token, { type: 'bearer' })),
    );
    const limited = responses.filter((res) => res.status === 429);
    expect(responses.filter((res) => res.status === 200).length).toBeLessThanOrEqual(limit);
    expect(limited.length).toBeGreaterThanOrEqual(5);
    expect(limited[0].body.code).toBe('rate_limited');
    expect(limited[0].headers['retry-after']).toBeDefined();
  });
});
