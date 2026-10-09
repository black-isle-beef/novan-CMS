import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { type ContentEvent, ContentEvents } from '@novan/api-content';
import { assets, assetUsages, auditEvents, DbService, entryVersions, publishedContent, spaces } from '@novan/api-db';
import type { Entry, EntryVersion } from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Subscription } from 'rxjs';
import request from 'supertest';
import { AppModule } from './app.module';

// The DB-backed block needs the local Supabase database (`npm run db:start && npm run db:reset`).
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';

// Seeded users and fixture (supabase/seed.sql). Tokens carry the role claims RLS reads, so any seeded
// user can play any role in the throwaway space below.
const agencyId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const novanAdminId = '00000000-0000-4000-8000-000000000003';
const organisationId = '00000000-0000-4000-8000-000000000100';
const demoSpaceId = '00000000-0000-4000-8000-000000000200';

function token(sub: string, spaces: { id: string; role: string }[]): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: 'aal1', spaces, agency_staff: false })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const hero = (n: number, heading: string) => ({ _uid: uid(n), _block: 'hero', heading });

describe('entries API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const entriesUrl = (spaceId: string) => `/v1/management/spaces/${spaceId}/environments/main/entries`;

  describe('guards and validation', () => {
    it.each([
      ['author', 'post', '/publish'],
      ['author', 'post', '/unpublish'],
      ['author', 'delete', ''],
      ['author', 'post', '/restore'],
      ['viewer', 'patch', ''],
      ['viewer', 'post', '/autosave'],
    ] as const)('answers 403 when an %s calls %s entries/:id%s', async (role, method, suffix) => {
      const res = await request(app.getHttpServer())
        [method](`${entriesUrl(demoSpaceId)}/${uid(1)}${suffix}`)
        .auth(await token(clientId, [{ id: demoSpaceId, role }]), { type: 'bearer' })
        .send({ data: {} });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('insufficient_role');
    });

    it('answers 403 for a space the caller is not a member of', async () => {
      const res = await request(app.getHttpServer())
        .get(entriesUrl(uid(99)))
        .auth(await token(clientId, [{ id: demoSpaceId, role: 'admin' }]), { type: 'bearer' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('space_forbidden');
    });

    it('refuses unknown properties, such as a status, when creating', async () => {
      const res = await request(app.getHttpServer())
        .post(entriesUrl(demoSpaceId))
        .auth(await token(clientId, [{ id: demoSpaceId, role: 'author' }]), { type: 'bearer' })
        .send({ contentType: 'page', status: 'published' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });
  });

  describe.skipIf(!hasDatabase)('with the database (RLS applies)', () => {
    const run = Date.now();
    let db: DbService;
    let spaceId: string;
    let developer: string;
    let author: string;
    let editor: string;
    let viewer: string;
    const events: ContentEvent[] = [];
    let subscription: Subscription;

    const server = () => app.getHttpServer();
    const base = () => `/v1/management/spaces/${spaceId}/environments/main`;
    const get = (path: string, as = editor) => request(server()).get(`${base()}${path}`).auth(as, { type: 'bearer' });
    const post = (path: string, body: object = {}, as = editor) =>
      request(server()).post(`${base()}${path}`).auth(as, { type: 'bearer' }).send(body);
    const patch = (path: string, body: object, as = editor) =>
      request(server()).patch(`${base()}${path}`).auth(as, { type: 'bearer' }).send(body);
    const del = (path: string, as = editor) => request(server()).delete(`${base()}${path}`).auth(as, { type: 'bearer' });

    const versionsOf = async (id: string): Promise<EntryVersion[]> => (await get(`/entries/${id}/versions`)).body;
    const auditActions = async (targetId: string) =>
      (
        await db.serviceDb
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(and(eq(auditEvents.spaceId, spaceId), eq(auditEvents.targetId, targetId)))
      ).map((row) => row.action);

    /** A complete, valid article. */
    const article = (title: string, slug: string) => ({
      title,
      slug,
      intro: doc('Hello'),
      rating: 4,
      featured: true,
      when: '2026-10-03',
      category: 'news',
      image: { assetId: uid(50), alt: 'A cat' },
      cta: { type: 'external', url: 'https://example.com', text: 'More' },
      related: [],
      content: [hero(1, 'One'), hero(2, 'Two')],
      extra: { any: ['json', 1] },
      seo: { metaTitle: 'Search title' },
    });

    beforeAll(async () => {
      db = app.get(DbService);
      subscription = app.get(ContentEvents).events$.subscribe((event) => events.push(event));
      const [space] = await db.serviceDb
        .insert(spaces)
        // With an onboarding checklist, as spaces created in the admin have (0009_onboarding.sql).
        .values({ organisationId, name: 'Entries test', slug: `entries-${run}`, settings: { onboarding: { completed: {}, dismissedAt: null } } })
        .returning({ id: spaces.id });
      spaceId = space.id;
      developer = await token(agencyId, [{ id: spaceId, role: 'developer' }]);
      author = await token(clientId, [{ id: spaceId, role: 'author' }]);
      editor = await token(novanAdminId, [{ id: spaceId, role: 'editor' }]);
      viewer = await token(clientId, [{ id: spaceId, role: 'viewer' }]);

      // The image the articles use (the media library's own tests upload real files).
      await db.serviceDb.insert(assets).values({
        id: uid(50),
        spaceId,
        path: `spaces/${spaceId}/${uid(50)}/cat.jpg`,
        filename: 'cat.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1,
        width: 1,
        height: 1,
      });

      // One field of every type, and two block types.
      const heroBlock = await post(
        '/block-types',
        { apiId: 'hero', name: 'Hero', fields: [{ id: 'h', apiId: 'heading', label: 'Heading', type: 'text', required: true, max: 50 }] },
        developer,
      );
      const columns = await post('/block-types', { apiId: 'columns', name: 'Columns', allowedChildren: ['hero'] }, developer);
      const type = await post(
        '/content-types',
        {
          apiId: 'article',
          name: 'Article',
          kind: 'page',
          fields: [
            { id: 'title', apiId: 'title', label: 'Title', type: 'text', required: true, max: 80 },
            { id: 'slug', apiId: 'slug', label: 'Slug', type: 'text', required: true, pattern: '[a-z0-9]+(-[a-z0-9]+)*' },
            { id: 'intro', apiId: 'intro', label: 'Intro', type: 'richText', marks: ['bold'], nodes: ['heading'] },
            { id: 'rating', apiId: 'rating', label: 'Rating', type: 'number', min: 1, max: 5, integer: true },
            { id: 'featured', apiId: 'featured', label: 'Featured', type: 'boolean' },
            { id: 'when', apiId: 'when', label: 'Date', type: 'date' },
            {
              id: 'category',
              apiId: 'category',
              label: 'Category',
              type: 'select',
              options: [
                { value: 'news', label: 'News' },
                { value: 'blog', label: 'Blog' },
              ],
            },
            { id: 'image', apiId: 'image', label: 'Image', type: 'media', requireAlt: true },
            { id: 'cta', apiId: 'cta', label: 'Button', type: 'link' },
            { id: 'related', apiId: 'related', label: 'Related', type: 'reference', contentTypes: ['article'], multiple: true },
            { id: 'content', apiId: 'content', label: 'Content', type: 'blocks', allowedBlocks: ['hero', 'columns'] },
            { id: 'extra', apiId: 'extra', label: 'Extra', type: 'json', required: true },
            {
              id: 'seo',
              apiId: 'seo',
              label: 'SEO',
              type: 'group',
              fields: [{ id: 'metaTitle', apiId: 'metaTitle', label: 'Search title', type: 'text', max: 60 }],
            },
          ],
        },
        developer,
      );
      expect([heroBlock.status, columns.status, type.status]).toEqual([201, 201, 201]);
    });

    afterAll(async () => {
      subscription?.unsubscribe();
      if (spaceId) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceId));
    });

    describe('saving drafts', () => {
      let entry: Entry;

      it('an author creates a page; its slug comes from the slug field', async () => {
        const res = await post('/entries', { contentType: 'article', data: { title: 'Draft', slug: 'draft-page' } }, author);
        expect(res.status).toBe(201);
        entry = res.body;
        expect(entry).toMatchObject({
          contentType: 'article',
          kind: 'page',
          slug: 'draft-page',
          path: '/draft-page',
          title: 'Draft',
          status: 'draft',
          missingTranslations: [],
          publishedVersionId: null,
        });
        expect(await versionsOf(entry.id)).toHaveLength(1);
        expect(await auditActions(entry.id)).toEqual(['entry.created']);
      });

      it('a viewer cannot create one', async () => {
        const res = await post('/entries', { contentType: 'article', data: { title: 'No' } }, viewer);
        expect(res.status).toBe(403);
      });

      it('takes the slug from the title when there is none, and refuses one already used in the folder', async () => {
        const res = await post('/entries', { contentType: 'article', data: { title: 'Draft Page' } }, author);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('slug_taken');

        const other = await post('/entries', { contentType: 'article', data: { title: 'Another One!' } }, author);
        expect(other.status).toBe(201);
        expect(other.body).toMatchObject({ slug: 'another-one', data: { slug: 'another-one' } });
      });

      it('saves an incomplete draft, but not one with a malformed value', async () => {
        const incomplete = await patch(`/entries/${entry.id}`, { data: { slug: 'draft-page' } }, author);
        expect(incomplete.status).toBe(200);
        expect(incomplete.body.title).toBe('draft-page');
      });

      it.each([
        ['text', { title: 'x'.repeat(81) }, 'title'],
        ['richText', { intro: { type: 'doc', content: [{ type: 'blockquote' }] } }, 'intro.content.0'],
        ['number', { rating: 2.5 }, 'rating'],
        ['boolean', { featured: 'yes' }, 'featured'],
        ['date', { when: '03/10/2026' }, 'when'],
        ['select', { category: 'sport' }, 'category'],
        ['media', { image: { assetId: 'not-an-id' } }, 'image.assetId'],
        ['link', { cta: { type: 'email', email: 'hi@example.com' } }, 'cta.type'],
        ['reference', { related: ['not-an-id'] }, 'related.0'],
        ['blocks', { content: [{ _uid: uid(1), _block: 'gallery' }] }, 'content.0._block'],
        ['blocks (block fields)', { content: [hero(1, 'x'.repeat(51))] }, 'content.0.heading'],
        ['group', { seo: { metaTitle: 42 } }, 'seo.metaTitle'],
      ])('refuses to save malformed %s data', async (_type, data, path) => {
        const before = (await versionsOf(entry.id)).length;
        const res = await patch(`/entries/${entry.id}`, { data: { slug: 'draft-page', ...data } }, author);

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('entry_invalid');
        expect(Object.keys(res.body.errors)).toContain(path);
        expect(await versionsOf(entry.id)).toHaveLength(before);
      });

      it('refuses a filled-in slug that is not a slug', async () => {
        const res = await patch(`/entries/${entry.id}`, { data: { slug: 'Not A Slug' } }, author);
        expect(res.status).toBe(400);
        expect(Object.keys(res.body.errors)).toContain('slug');
      });

      it('refuses to publish incomplete data (a required json field is missing)', async () => {
        const res = await post(`/entries/${entry.id}/publish`);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('entry_invalid');
        expect(Object.keys(res.body.errors)).toEqual(expect.arrayContaining(['title', 'extra']));
      });
    });

    describe('versions, publishing and restoring', () => {
      let entry: Entry;
      let v1: string;
      let v2: string;

      beforeAll(async () => {
        const res = await post('/entries', { contentType: 'article', data: article('Hello world', 'hello-world'), message: 'First' }, author);
        expect(res.status).toBe(201);
        entry = res.body;
        v1 = entry.currentVersionId;
      });

      it('an author cannot publish; an editor can, and the version is copied into published content', async () => {
        expect((await post(`/entries/${entry.id}/publish`, {}, author)).status).toBe(403);

        events.length = 0;
        const res = await post(`/entries/${entry.id}/publish`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'published', publishedVersionId: v1, publishedPath: '/hello-world', hasUnpublishedChanges: false });

        const [published] = await db.serviceDb.select().from(publishedContent).where(eq(publishedContent.entryId, entry.id));
        expect(published).toMatchObject({ contentTypeApiId: 'article', fullPath: '/hello-world' });
        expect(published.data).toMatchObject({ title: 'Hello world', content: [hero(1, 'One'), hero(2, 'Two')] });
        expect(published.cacheTags).toEqual([`entry:${entry.id}`, `type:${published.environmentId}:article`]);
        expect(await db.serviceDb.select().from(assetUsages).where(eq(assetUsages.entryId, entry.id))).toEqual([
          { assetId: uid(50), entryId: entry.id, spaceId, fieldPath: 'image' },
        ]);

        expect(events).toEqual([
          expect.objectContaining({ type: 'entry.published', entryId: entry.id, versionId: v1, path: '/hello-world', spaceId }),
        ]);
        expect(await auditActions(entry.id)).toContain('entry.published');
      });

      it('saving makes a new version and leaves the old one, and the published copy, as they were', async () => {
        const data = { ...article('Hello again', 'hello-world'), content: [hero(2, 'Two'), hero(1, 'One'), hero(3, 'Three')] };
        const res = await patch(`/entries/${entry.id}`, { data, message: 'Second' }, author);
        expect(res.status).toBe(200);
        v2 = res.body.currentVersionId;
        expect(v2).not.toBe(v1);
        expect(res.body).toMatchObject({ title: 'Hello again', hasUnpublishedChanges: true, publishedVersionId: v1 });

        const [old] = await db.serviceDb.select().from(entryVersions).where(eq(entryVersions.id, v1));
        expect(old.data).toMatchObject({ title: 'Hello world' });
        const [published] = await db.serviceDb.select().from(publishedContent).where(eq(publishedContent.entryId, entry.id));
        expect(published.data).toMatchObject({ title: 'Hello world' });

        const versions = await versionsOf(entry.id);
        expect(versions.map((v) => [v.message, v.current, v.published])).toEqual([
          ['Second', true, false],
          ['First', false, true],
        ]);
        // Names come from profiles, which RLS shows to the person themselves and to co-members.
        const own: EntryVersion[] = (await get(`/entries/${entry.id}/versions`, author)).body;
        expect(own[0].createdByName).toBe('Client User');
      });

      it('diffs two versions, matching blocks by _uid', async () => {
        const res = await get(`/versions/${v1}/diff/${v2}`);
        expect(res.status).toBe(200);
        expect(res.body.changes).toEqual([
          { kind: 'changed', path: ['title'], before: 'Hello world', after: 'Hello again' },
          { kind: 'added', path: ['content', uid(3)], block: 'hero', after: hero(3, 'Three') },
          { kind: 'moved', path: ['content', uid(2)], block: 'hero', from: 1, to: 0 },
          { kind: 'moved', path: ['content', uid(1)], block: 'hero', from: 0, to: 1 },
        ]);
      });

      it('restores v1 by moving the pointer, without a new version', async () => {
        const res = await post(`/entries/${entry.id}/restore/${v1}`, {}, author);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ currentVersionId: v1, title: 'Hello world', hasUnpublishedChanges: false });
        expect(await versionsOf(entry.id)).toHaveLength(2);
        expect(await auditActions(entry.id)).toContain('entry.version_restored');

        const missing = await post(`/entries/${entry.id}/restore/${uid(77)}`, {}, author);
        expect(missing.status).toBe(404);
      });

      it('autosave makes one version, then overwrites it while it is recent', async () => {
        const first = await post(`/entries/${entry.id}/autosave`, { data: article('Typing', 'hello-world') }, author);
        const second = await post(`/entries/${entry.id}/autosave`, { data: article('Typing more', 'hello-world') }, author);
        expect([first.status, second.status]).toEqual([200, 200]);
        expect(second.body.currentVersionId).toBe(first.body.currentVersionId);
        expect(second.body.title).toBe('Typing more');

        const versions = await versionsOf(entry.id);
        expect(versions).toHaveLength(3);
        expect(versions[0]).toMatchObject({ autosave: true, current: true });

        // Someone else's autosave is never overwritten.
        const other = await post(`/entries/${entry.id}/autosave`, { data: article('Editor typing', 'hello-world') });
        expect(other.body.currentVersionId).not.toBe(second.body.currentVersionId);
        expect(await versionsOf(entry.id)).toHaveLength(4);
      });

      it('a published autosave is not overwritten', async () => {
        await post(`/entries/${entry.id}/publish`);
        const before = (await get(`/entries/${entry.id}`)).body.currentVersionId;
        const res = await post(`/entries/${entry.id}/autosave`, { data: article('After publish', 'hello-world') });
        expect(res.body.currentVersionId).not.toBe(before);
      });

      it('unpublishes: the published copy goes and the entry is a draft again', async () => {
        events.length = 0;
        const res = await post(`/entries/${entry.id}/unpublish`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'draft', publishedVersionId: null, publishedPath: null, publishedAt: null });
        expect(await db.serviceDb.select().from(publishedContent).where(eq(publishedContent.entryId, entry.id))).toEqual([]);
        expect(await db.serviceDb.select().from(assetUsages).where(eq(assetUsages.entryId, entry.id))).toEqual([]);
        expect(events).toEqual([expect.objectContaining({ type: 'entry.unpublished', entryId: entry.id, path: '/hello-world' })]);
        expect((await post(`/entries/${entry.id}/unpublish`)).body.code).toBe('not_published');
      });

      it('refuses to publish an entry the content model no longer accepts', async () => {
        // A forced change makes `rating` text; the entry's stored number is now wrong.
        const type = (await get('/content-types/article', developer)).body;
        const fields = type.fields.map((f: { apiId: string }) => (f.apiId === 'rating' ? { id: 'rating', apiId: 'rating', label: 'Rating', type: 'text' } : f));
        const refused = await patch('/content-types/article', { fields }, developer);
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('entries_invalidated');
        expect(refused.body.affectedEntries).toBeGreaterThan(0);

        expect((await request(server()).patch(`${base()}/content-types/article?force=true`).auth(developer, { type: 'bearer' }).send({ fields })).status).toBe(200);
        const res = await post(`/entries/${entry.id}/publish`);
        expect(res.status).toBe(400);
        expect(Object.keys(res.body.errors)).toContain('rating');

        await request(server()).patch(`${base()}/content-types/article?force=true`).auth(developer, { type: 'bearer' }).send({ fields: type.fields });
      });
    });

    describe('folders, moving and the bin', () => {
      let page: Entry;
      let folderId: string;

      beforeAll(async () => {
        page = (await post('/entries', { contentType: 'article', data: article('Inside', 'inside') }, author)).body;
        await post(`/entries/${page.id}/publish`);
      });

      it('an author adds a folder but cannot rename it', async () => {
        const res = await post('/folders', { name: 'Blog', slug: 'blog' }, author);
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ path: '/blog', parentId: null });
        folderId = res.body.id;

        expect((await patch(`/folders/${folderId}`, { slug: 'news' }, author)).status).toBe(403);
        expect((await post('/folders', { name: 'Blog again', slug: 'blog' }, author)).body.code).toBe('folder_path_taken');
      });

      it('moving a published page needs an editor, and moves its published address', async () => {
        expect((await post(`/entries/${page.id}/move`, { folderId }, author)).status).toBe(403);

        const res = await post(`/entries/${page.id}/move`, { folderId });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ folderId, path: '/blog/inside', publishedPath: '/blog/inside' });
        expect(await auditActions(page.id)).toContain('entry.moved');
      });

      it('renaming a folder moves the published pages inside it', async () => {
        const res = await patch(`/folders/${folderId}`, { slug: 'journal', name: 'Journal' });
        expect(res.status).toBe(200);
        expect(res.body.path).toBe('/journal');
        expect((await get(`/entries/${page.id}`)).body).toMatchObject({ path: '/journal/inside', publishedPath: '/journal/inside' });

        const child = await post('/folders', { name: 'Child', slug: 'child', parentId: folderId }, author);
        const cycle = await patch(`/folders/${folderId}`, { parentId: child.body.id });
        expect(cycle.status).toBe(400);
        expect(cycle.body.code).toBe('folder_cycle');
        await del(`/folders/${child.body.id}`);
      });

      it('lists by folder and search', async () => {
        const inFolder = await get(`/entries?folderId=${folderId}`);
        expect(inFolder.body.map((e: Entry) => e.id)).toEqual([page.id]);
        const search = await get('/entries?search=insi');
        expect(search.body.map((e: Entry) => e.id)).toEqual([page.id]);
        const root = await get('/entries?folderId=root');
        expect(root.body.map((e: Entry) => e.id)).not.toContain(page.id);
      });

      it('refuses to delete a folder that is not empty', async () => {
        const res = await del(`/folders/${folderId}`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('folder_not_empty');
      });

      it('the bin: an author cannot use it; an editor bins (unpublishing first) and restores', async () => {
        expect((await del(`/entries/${page.id}`, author)).status).toBe(403);

        events.length = 0;
        expect((await del(`/entries/${page.id}`)).status).toBe(204);
        expect(events.map((e) => e.type)).toEqual(['entry.unpublished']);
        expect((await get('/entries')).body.map((e: Entry) => e.id)).not.toContain(page.id);
        const bin = await get('/entries?deleted=true');
        expect(bin.body).toEqual([expect.objectContaining({ id: page.id, status: 'draft' })]);
        expect((await patch(`/entries/${page.id}`, { data: {} }, author)).body.code).toBe('entry_deleted');

        // The empty folder can go; the binned page moves to the top level.
        expect((await del(`/folders/${folderId}`)).status).toBe(204);

        const restored = await post(`/entries/${page.id}/restore`);
        expect(restored.status).toBe(200);
        expect(restored.body).toMatchObject({ deletedAt: null, folderId: null, path: '/inside', status: 'draft' });
        expect(await auditActions(page.id)).toEqual(expect.arrayContaining(['entry.deleted', 'entry.restored']));
      });
    });

    it('records onboarding steps as people do them: a new page, publishing, then editing the home page', async () => {
      const checklist = async () =>
        (await request(server()).get(`/v1/management/spaces/${spaceId}/onboarding`).auth(viewer, { type: 'bearer' })).body.checklist;
      // Earlier tests created pages and published one.
      expect(Object.keys((await checklist()).completed).sort()).toEqual(['newPage', 'publish']);

      const home = await post('/entries', { contentType: 'article', data: { title: 'Home', slug: 'home', extra: {} } }, author);
      expect(home.status).toBe(201);
      expect((await checklist()).completed).not.toHaveProperty('homePage');
      expect((await patch(`/entries/${home.body.id}`, { data: { title: 'Welcome', slug: 'home', extra: {} } }, author)).status).toBe(200);

      const { completed, dismissedAt } = await checklist();
      expect(Object.keys(completed).sort()).toEqual(['homePage', 'newPage', 'publish']);
      expect(dismissedAt).toBeNull();
    });

    it('a viewer cannot dismiss the checklist; an author can, for everyone', async () => {
      const dismiss = (as: string) =>
        request(server()).post(`/v1/management/spaces/${spaceId}/onboarding/dismiss`).auth(as, { type: 'bearer' });

      expect((await dismiss(viewer)).status).toBe(403);
      const res = await dismiss(author);
      expect(res.status).toBe(200);
      expect(res.body.checklist.dismissedAt).toEqual(expect.any(String));
    });

    it('a member of the demo space cannot read this one, through the API or the database', async () => {
      const outsider = await token(clientId, [{ id: demoSpaceId, role: 'admin' }]);
      const res = await request(server()).get(`${base()}/entries`).auth(outsider, { type: 'bearer' });
      expect(res.status).toBe(403);

      const rows = await db.userDb({ sub: clientId, role: 'authenticated', spaces: [{ id: demoSpaceId, role: 'admin' }] }, (tx) =>
        tx.execute(`select 1 from public.entry_versions where space_id = '${spaceId}'`),
      );
      expect(rows).toHaveLength(0);
    });
  });
});
