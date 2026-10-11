import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { assets, DbService, entries, entryVersions, environments, publishedContent, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import type { AdminSearchResults, CreatedApiToken, DeliveryEntriesPage, Entry } from '@novan/shared-schemas';
import { and, eq, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// Search (docs/build/18-search-forms-audit.md): `q` on the Delivery and Preview APIs and the admin's global search.
// Needs the local Supabase database; who may read the search rows is in supabase/tests/search.test.sql. The last test
// checks the package's target: results within 100 ms on 10,000 entries.
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
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** Words for the 10,000 generated entries; `zebra` is rare (one entry in 500), `garden` common (one in five). */
const vocabulary = (
  'about above across after again along always among another answer around autumn before begin behind below beside ' +
  'between beyond bright bring brother build business careful carry centre change chapter church circle city clear ' +
  'close colour common company country course cover create cross dance daughter decide design detail develop ' +
  'different direct distance doctor double during early earth easy education energy enough evening event every ' +
  'example family famous father field figure final finger finish follow forest forward friend future general'
).split(' ');

describe.skipIf(!hasDatabase)('search', () => {
  const run = Date.now();
  let app: INestApplication;
  let db: DbService;
  let space: string;
  let other: string;
  let admin: string;
  let editor: string;
  let author: string;
  let outsider: string;
  let delivery: CreatedApiToken;
  let preview: CreatedApiToken;
  let otherDelivery: CreatedApiToken;
  let roses: Entry;
  let tulips: Entry;
  let recipe: Entry;
  let draft: Entry;

  const server = () => app.getHttpServer();
  const as = (token: string, spaceId = space) => ({
    get: (path: string) => request(server()).get(`/v1/management/spaces/${spaceId}${path}`).auth(token, { type: 'bearer' }),
    post: (path: string, body: object = {}) =>
      request(server()).post(`/v1/management/spaces/${spaceId}${path}`).auth(token, { type: 'bearer' }).send(body),
    delete: (path: string) => request(server()).delete(`/v1/management/spaces/${spaceId}${path}`).auth(token, { type: 'bearer' }),
  });
  const api = (token: CreatedApiToken, path: string) =>
    request(server()).get(`/v1/${token.scope}/${path}`).auth(token.token, { type: 'bearer' });
  const ids = (page: DeliveryEntriesPage) => page.items.map((item) => item.id);

  const create = async (contentType: string, data: object, publish: boolean): Promise<Entry> => {
    const created = await as(editor).post('/environments/main/entries', { contentType, data });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    if (publish) expect((await as(editor).post(`/environments/main/entries/${created.body.id}/publish`)).status).toBe(200);
    return created.body;
  };

  beforeAll(async () => {
    process.env['DELIVERY_RATE_LIMIT'] = '100000';
    process.env['PREVIEW_RATE_LIMIT'] = '100000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue({ enabled: false })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);
    [{ id: space }] = await db.serviceDb.insert(spaces).values({ organisationId, name: 'Search', slug: `search-${run}` }).returning({ id: spaces.id });
    [{ id: other }] = await db.serviceDb.insert(spaces).values({ organisationId, name: 'Elsewhere', slug: `search-other-${run}` }).returning({ id: spaces.id });
    admin = await jwt(novanAdminId, space, 'admin');
    editor = await jwt(novanAdminId, space, 'editor');
    author = await jwt(novanAdminId, space, 'author');
    outsider = await jwt(novanAdminId, other, 'admin');

    expect((await as(admin).post('/locales', { code: 'fr-FR', name: 'French', fallback: 'en-GB' })).status).toBe(201);
    const page = await as(admin).post('/environments/main/content-types', {
      apiId: 'page',
      name: 'Page',
      kind: 'page',
      fields: [
        field('title', 'text', { required: true, localised: true }),
        field('slug', 'text', { required: true }),
        field('body', 'richText', { localised: true }),
      ],
    });
    expect(page.status, JSON.stringify(page.body)).toBe(201);
    const recipeType = await as(admin).post('/environments/main/content-types', {
      apiId: 'recipe',
      name: 'Recipe',
      kind: 'entry',
      fields: [field('title', 'text', { required: true }), field('method', 'text', { multiline: true })],
    });
    expect(recipeType.status, JSON.stringify(recipeType.body)).toBe(201);

    roses = await create(
      'page',
      {
        title: { 'en-GB': 'Rose garden', 'fr-FR': 'Roseraie' },
        slug: 'rose-garden',
        body: { 'en-GB': doc('Our roses bloom from June. Walk the garden at dusk.'), 'fr-FR': doc('Nos roses fleurissent en juin.') },
      },
      true,
    );
    tulips = await create('page', { title: { 'en-GB': 'Tulip fields' }, slug: 'tulips', body: { 'en-GB': doc('A spring garden of tulips beside roses.') } }, true);
    recipe = await create('recipe', { title: 'Rose petal jam', method: 'Simmer the petals with sugar.' }, true);
    draft = await create('page', { title: { 'en-GB': 'Rose festival' }, slug: 'rose-festival' }, false);

    for (const [scope, spaceId, token] of [
      ['delivery', space, admin],
      ['preview', space, admin],
      ['delivery', other, outsider],
    ] as const) {
      const res = await as(token, spaceId).post('/api-tokens', { name: `${scope} ${run}`, scope });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      if (spaceId === other) otherDelivery = res.body;
      else if (scope === 'delivery') delivery = res.body;
      else preview = res.body;
    }
  });

  afterAll(async () => {
    delete process.env['DELIVERY_RATE_LIMIT'];
    delete process.env['PREVIEW_RATE_LIMIT'];
    for (const id of [space, other]) if (id) await db.serviceDb.delete(spaces).where(eq(spaces.id, id));
    await app?.close();
  });

  describe('the Delivery API', () => {
    it('finds published entries, the best match first, with a snippet', async () => {
      const res = await api(delivery, 'entries?q=roses');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const page: DeliveryEntriesPage = res.body;
      // "Rose" in the title counts most; the draft is not published.
      expect(ids(page).slice(0, 2).sort()).toEqual([roses.id, recipe.id].sort());
      expect(ids(page)).toContain(tulips.id);
      expect(ids(page)).not.toContain(draft.id);
      const [first] = page.items;
      expect(first.search?.rank).toBeGreaterThan(page.items[2].search?.rank ?? 1);
      const rose = page.items.find((item) => item.id === roses.id);
      expect(rose?.search?.snippet).toEqual(
        expect.arrayContaining([{ text: 'roses', match: true }, expect.objectContaining({ match: false })]),
      );
      expect(rose?.data['title']).toBe('Rose garden');
      expect(res.headers['cache-tag']).toContain(`entries:`);
    });

    it('finds words as they are typed and needs every word', async () => {
      expect(ids((await api(delivery, 'entries?q=tuli')).body)).toEqual([tulips.id]);
      expect(ids((await api(delivery, 'entries?q=garden%20dusk')).body)).toEqual([roses.id]);
      expect(ids((await api(delivery, 'entries?q=nothing%20like%20this')).body)).toEqual([]);
    });

    it('filters by type and pages through results', async () => {
      expect(ids((await api(delivery, 'entries?q=rose&type=recipe')).body)).toEqual([recipe.id]);
      const first: DeliveryEntriesPage = (await api(delivery, 'entries?q=rose&limit=2')).body;
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second: DeliveryEntriesPage = (await api(delivery, `entries?q=rose&limit=2&cursor=${first.nextCursor}`)).body;
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...ids(first), ...ids(second)]).size).toBe(3);
      expect((await api(delivery, `entries?limit=2&cursor=${first.nextCursor}`)).body.code).toBe('invalid_cursor');
    });

    it('cuts snippets from the requested locale', async () => {
      const res = await api(delivery, 'entries?q=roses&locale=fr-FR&type=page');
      const rose = (res.body as DeliveryEntriesPage).items.find((item) => item.id === roses.id);
      expect(rose?.data['title']).toBe('Roseraie');
      expect(rose?.search?.snippet.map((part) => part.text).join('')).toContain('fleurissent');
    });

    it('refuses searches it cannot run', async () => {
      for (const query of ['q=%21%21', 'q=rose&sort=-updatedAt', 'q=rose&type=recipe&fields.title=x', 'sort=relevance']) {
        const res = await api(delivery, `entries?${query}`);
        expect(res.status, query).toBe(400);
      }
    });

    it('never finds another space\'s content', async () => {
      const res = await api(otherDelivery, 'entries?q=rose');
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('the Preview API', () => {
    it('searches drafts as last saved, without the bin', async () => {
      expect(ids((await api(preview, 'entries?q=festival')).body)).toEqual([draft.id]);
      expect((await as(editor).delete(`/environments/main/entries/${draft.id}`)).status).toBe(204);
      expect(ids((await api(preview, 'entries?q=festival')).body)).toEqual([]);
      expect((await as(editor).post(`/environments/main/entries/${draft.id}/restore`)).status).toBe(200);
    });
  });

  describe('the admin\'s global search', () => {
    beforeAll(async () => {
      const id = randomUUID();
      await db.serviceDb.insert(assets).values({
        id,
        spaceId: space,
        path: `spaces/${space}/${id}/rose-arch.jpg`,
        filename: 'rose-arch.jpg',
        mime: 'image/jpeg',
        sizeBytes: 100,
        alt: 'An arch of climbing roses',
      });
    });

    it('finds pages, entries and media for anyone in the space', async () => {
      const res = await as(author).get('/search?q=rose');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const results: AdminSearchResults = res.body;
      expect(results.pages.map((hit) => hit.title)).toEqual(expect.arrayContaining(['Rose garden', 'Rose festival']));
      expect(results.pages.find((hit) => hit.id === roses.id)).toEqual({
        kind: 'page',
        id: roses.id,
        title: 'Rose garden',
        detail: '/rose-garden',
        status: 'published',
      });
      expect(results.entries).toEqual([{ kind: 'entry', id: recipe.id, title: 'Rose petal jam', detail: 'Recipe', status: 'published' }]);
      expect(results.media).toEqual([expect.objectContaining({ kind: 'media', title: 'rose-arch.jpg', detail: 'rose-arch.jpg' })]);
    });

    it('finds by slug and by the start of a word', async () => {
      expect((await as(author).get('/search?q=festiv')).body.pages.map((hit: { id: string }) => hit.id)).toEqual([draft.id]);
      expect((await as(author).get('/search?q=tulips')).body.pages.map((hit: { id: string }) => hit.id)).toEqual([tulips.id]);
    });

    it('is only for people in the space', async () => {
      expect((await as(outsider).get('/search?q=rose')).status).toBe(403);
      const res = await as(outsider, other).get('/search?q=rose');
      expect(res.body).toEqual({ pages: [], entries: [], media: [] });
      expect((await as(author).get('/search?q=')).status).toBe(400);
      expect((await as(author).get('/search?q=rose&environment=staging')).body.code).toBe('environment_not_found');
    });
  });

  describe('at scale', () => {
    let big: string;
    let bigDelivery: CreatedApiToken;
    let bigAdmin: string;

    beforeAll(async () => {
      [{ id: big }] = await db.serviceDb.insert(spaces).values({ organisationId, name: 'Big', slug: `search-big-${run}` }).returning({ id: spaces.id });
      bigAdmin = await jwt(novanAdminId, big, 'admin');
      const type = await as(bigAdmin, big).post('/environments/main/content-types', {
        apiId: 'article',
        name: 'Article',
        kind: 'page',
        fields: [field('title', 'text', { required: true, localised: true }), field('slug', 'text', { required: true }), field('body', 'richText', { localised: true })],
      });
      expect(type.status, JSON.stringify(type.body)).toBe(201);
      bigDelivery = (await as(bigAdmin, big).post('/api-tokens', { name: 'Big', scope: 'delivery' })).body;

      // 10,000 published articles of about a hundred words each, written as publishing writes them.
      const [env] = await db.serviceDb.select({ id: environments.id }).from(environments).where(and(eq(environments.spaceId, big), eq(environments.isMain, true)));
      const typeId = type.body.id as string;
      let seed = 1;
      const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const words = (n: number) => Array.from({ length: n }, () => vocabulary[Math.floor(random() * vocabulary.length)]).join(' ');
      for (let batch = 0; batch < 10; batch++) {
        const rows = Array.from({ length: 1000 }, (_, i) => {
          const n = batch * 1000 + i;
          const extra = `${n % 5 === 0 ? ' garden' : ''}${n % 500 === 0 ? ' zebra' : ''}`;
          return {
            id: randomUUID(),
            slug: `article-${n}`,
            data: {
              title: { 'en-GB': `${words(4)}${n % 500 === 0 ? ' zebra' : ''}` },
              slug: `article-${n}`,
              body: { 'en-GB': doc(`${words(100)}${extra}.`) },
            },
          };
        });
        await db.serviceDb.transaction(async (tx) => {
          await tx.insert(entries).values(rows.map((row) => ({ id: row.id, spaceId: big, environmentId: env.id, contentTypeId: typeId, slug: row.slug })));
          const versions = await tx
            .insert(entryVersions)
            .values(rows.map((row) => ({ entryId: row.id, spaceId: big, data: row.data, message: 'Generated' })))
            .returning({ id: entryVersions.id, entryId: entryVersions.entryId });
          await tx.execute(sql`update public.entries e
            set current_version_id = v.id, published_version_id = v.id, status = 'published', published_at = now()
            from (select unnest(${sql.raw(`array['${versions.map((v) => v.id).join("','")}']::uuid[]`)}) as id,
                         unnest(${sql.raw(`array['${versions.map((v) => v.entryId).join("','")}']::uuid[]`)}) as entry_id) v
            where e.id = v.entry_id`);
          await tx.insert(publishedContent).values(
            rows.map((row) => ({
              entryId: row.id,
              spaceId: big,
              environmentId: env.id,
              contentTypeApiId: 'article',
              fullPath: `/${row.slug}`,
              data: row.data,
              publishedAt: sql`now()`,
            })),
          );
        });
      }
      await db.serviceDb.execute(sql`analyze public.published_content, public.entry_search`);
    }, 300_000);

    afterAll(async () => {
      if (big) await db.serviceDb.delete(spaces).where(eq(spaces.id, big));
    });

    /** The median of five timed requests, after one to warm up. */
    const timed = async (send: () => request.Test): Promise<{ ms: number; body: unknown }> => {
      let body: unknown = null;
      expect((await send()).status).toBe(200);
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const started = performance.now();
        const res = await send();
        times.push(performance.now() - started);
        expect(res.status).toBe(200);
        body = res.body;
      }
      return { ms: times.sort((a, b) => a - b)[2], body };
    };

    it.each([
      ['a rare word', 'zebra', 20],
      ['a common word', 'garden', 25],
      ['two words, the last unfinished', 'garden ev', 25],
    ])('the Delivery API finds %s among 10,000 entries within 100 ms', async (_, q, expected) => {
      const { ms, body } = await timed(() => api(bigDelivery, `entries?q=${encodeURIComponent(q)}&include=0`));
      expect((body as DeliveryEntriesPage).items).toHaveLength(expected);
      expect(ms).toBeLessThan(100);
    });

    it('the admin finds pages among 10,000 within 100 ms', async () => {
      const { ms, body } = await timed(() => as(bigAdmin, big).get('/search?q=zebra'));
      expect((body as AdminSearchResults).pages).toHaveLength(6);
      expect(ms).toBeLessThan(100);
    });
  });
});
