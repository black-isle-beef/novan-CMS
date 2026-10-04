import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { assetUsages, auditEvents, DbService, spaces } from '@novan/api-db';
import { type MediaEvent, MediaEvents } from '@novan/api-media';
import type { Asset, AssetDetail, Entry, UploadUrlResponse } from '@novan/shared-schemas';
import { createClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from './app.module';

// The storage-backed block needs the local Supabase stack (`npm run db:start && npm run db:reset`) and the
// keys in .env.local: uploads go to the real `media` bucket.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasStorage = Boolean(
  process.env['DATABASE_URL'] &&
    process.env['SUPABASE_URL'] &&
    process.env['SUPABASE_SERVICE_ROLE_KEY'] &&
    process.env['SUPABASE_ANON_KEY'],
);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';

// Seeded users and fixture (supabase/seed.sql).
const agencyId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const novanAdminId = '00000000-0000-4000-8000-000000000003';
const organisationId = '00000000-0000-4000-8000-000000000100';
const demoSpaceId = '00000000-0000-4000-8000-000000000200';

const claims = (sub: string, spaces: { id: string; role: string }[]) => ({
  role: 'authenticated',
  aal: 'aal1',
  spaces,
  agency_staff: false,
  sub,
});

/** For the API, which the test module verifies with `secret`. */
function token(sub: string, spaces: { id: string; role: string }[], key = secret): Promise<string> {
  return new SignJWT(claims(sub, spaces))
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(key));
}

const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const png = (width: number, height: number, background = '#c00') =>
  sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();

describe('media library API', () => {
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

  const assetsUrl = (spaceId: string) => `/v1/management/spaces/${spaceId}/assets`;

  describe('guards and validation', () => {
    it.each([
      ['viewer', 'post', '/upload-url'],
      ['viewer', 'post', '/complete'],
      ['viewer', 'patch', `/${uid(1)}`],
      ['author', 'post', `/${uid(1)}/replace-url`],
      ['author', 'post', `/${uid(1)}/replace`],
      ['author', 'delete', `/${uid(1)}`],
      ['author', 'post', `/${uid(1)}/restore`],
    ] as const)('answers 403 when a %s calls %s assets%s', async (role, method, suffix) => {
      const res = await request(app.getHttpServer())
        [method](`${assetsUrl(demoSpaceId)}${suffix}`)
        .auth(await token(clientId, [{ id: demoSpaceId, role }]), { type: 'bearer' })
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('insufficient_role');
    });

    it('answers 403 for a space the caller is not a member of', async () => {
      const res = await request(app.getHttpServer())
        .get(assetsUrl(uid(99)))
        .auth(await token(clientId, [{ id: demoSpaceId, role: 'admin' }]), { type: 'bearer' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('space_forbidden');
    });

    it('checks resize options on the image route', async () => {
      const res = await request(app.getHttpServer()).get(`/v1/assets/${uid(1)}/a.png?width=99999`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });
  });

  describe.skipIf(!hasStorage)('with the database and storage (RLS applies)', () => {
    const run = Date.now();
    let db: DbService;
    let spaceId: string;
    let developer: string;
    let editor: string;
    let author: string;
    let viewer: string;
    const events: MediaEvent[] = [];

    const server = () => app.getHttpServer();
    const base = () => `/v1/management/spaces/${spaceId}`;
    const get = (path: string, as = editor) => request(server()).get(`${base()}${path}`).auth(as, { type: 'bearer' });
    const post = (path: string, body: object = {}, as = editor) =>
      request(server()).post(`${base()}${path}`).auth(as, { type: 'bearer' }).send(body);
    const patch = (path: string, body: object, as = editor) =>
      request(server()).patch(`${base()}${path}`).auth(as, { type: 'bearer' }).send(body);
    const del = (path: string, as = editor) =>
      request(server()).delete(`${base()}${path}`).auth(as, { type: 'bearer' });

    /** The browser's part: PUT the bytes to the signed URL. */
    async function put(target: UploadUrlResponse, bytes: Buffer, contentType = target.mime): Promise<void> {
      const res = await fetch(target.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body: new Uint8Array(bytes),
      });
      expect(res.status, await res.clone().text()).toBe(200);
    }

    /** All three steps; answers the `complete` response. */
    async function upload(filename: string, bytes: Buffer, as = editor, extra: object = {}) {
      const signed = await post('/assets/upload-url', { filename, sizeBytes: bytes.length }, as);
      expect(signed.status, JSON.stringify(signed.body)).toBe(200);
      await put(signed.body, bytes);
      return post('/assets/complete', { assetId: signed.body.assetId, filename, ...extra }, as);
    }

    const audit = async (targetId: string) =>
      (
        await db.serviceDb
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(and(eq(auditEvents.spaceId, spaceId), eq(auditEvents.targetId, targetId)))
      ).map((row) => row.action);

    beforeAll(async () => {
      db = app.get(DbService);
      app.get(MediaEvents).events$.subscribe((event) => events.push(event));
      const [space] = await db.serviceDb
        .insert(spaces)
        .values({ organisationId, name: 'Media test', slug: `media-${run}` })
        .returning({ id: spaces.id });
      spaceId = space.id;
      developer = await token(agencyId, [{ id: spaceId, role: 'developer' }]);
      editor = await token(novanAdminId, [{ id: spaceId, role: 'editor' }]);
      author = await token(clientId, [{ id: spaceId, role: 'author' }]);
      viewer = await token(clientId, [{ id: spaceId, role: 'viewer' }]);

      const type = await post(
        '/environments/main/content-types',
        {
          apiId: 'article',
          name: 'Article',
          kind: 'page',
          fields: [
            { id: 'title', apiId: 'title', label: 'Title', type: 'text', required: true },
            { id: 'slug', apiId: 'slug', label: 'Slug', type: 'text', required: true },
            { id: 'image', apiId: 'image', label: 'Image', type: 'media', requireAlt: true },
            { id: 'doc', apiId: 'doc', label: 'Download', type: 'media', accept: ['file'] },
          ],
        },
        developer,
      );
      expect(type.status).toBe(201);
    });

    afterAll(async () => {
      if (!spaceId) return;
      const storage = createClient(
        process.env['SUPABASE_URL'] as string,
        process.env['SUPABASE_SERVICE_ROLE_KEY'] as string,
      ).storage;
      const folders = await storage.from('media').list(`spaces/${spaceId}`, { limit: 1000 });
      for (const folder of folders.data ?? []) {
        const files = await storage.from('media').list(`spaces/${spaceId}/${folder.name}`, { limit: 1000 });
        await storage
          .from('media')
          .remove((files.data ?? []).map((file) => `spaces/${spaceId}/${folder.name}/${file.name}`));
      }
      await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceId));
    });

    describe('uploading', () => {
      it('signs an upload, checks the file and adds it with its size, a safe name and a title', async () => {
        const res = await upload('Team photo.PNG', await png(64, 48), author, {
          folder: 'People/Team',
          tags: ['Team'],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body).toMatchObject({
          filename: 'Team-photo.png',
          title: 'Team photo',
          mime: 'image/png',
          kind: 'image',
          width: 64,
          height: 48,
          folder: 'People/Team',
          tags: ['team'],
          revision: 1,
          usageCount: 0,
          usages: [],
          uploadedByName: 'Client User',
        });
        expect(await audit(res.body.id)).toEqual(['asset.uploaded']);
      });

      it('refuses types the library never takes, and SVG unless the space allows it', async () => {
        const html = await post('/assets/upload-url', { filename: 'page.html', sizeBytes: 10 });
        expect(html.body.code).toBe('file_type_not_allowed');
        const svg = await post('/assets/upload-url', { filename: 'logo.svg', sizeBytes: 10 });
        expect(svg.body.code).toBe('svg_not_allowed');
      });

      it('refuses images over 20 MB but allows documents up to 50 MB', async () => {
        const big = await post('/assets/upload-url', { filename: 'huge.jpg', sizeBytes: 21 * 1024 * 1024 });
        expect(big.status).toBe(400);
        expect(big.body).toMatchObject({ code: 'file_too_large', detail: 'Images can be up to 20 MB.' });
        const pdf = await post('/assets/upload-url', { filename: 'brochure.pdf', sizeBytes: 21 * 1024 * 1024 });
        expect(pdf.status).toBe(200);
        expect(pdf.body.maxBytes).toBe(50 * 1024 * 1024);
      });

      it('refuses a web page dressed up as a picture, and removes it', async () => {
        const signed = await post('/assets/upload-url', { filename: 'cat.png', sizeBytes: 50 });
        await put(signed.body, Buffer.from('<!doctype html><script>alert(document.cookie)</script>'));
        const res = await post('/assets/complete', { assetId: signed.body.assetId, filename: 'cat.png' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('file_type_mismatch');

        const again = await post('/assets/complete', { assetId: signed.body.assetId, filename: 'cat.png' });
        expect(again.status).toBe(404);
        expect(again.body.code).toBe('upload_not_found');
      });

      it('answers 404 when nothing was uploaded, and 409 when completing twice', async () => {
        expect((await post('/assets/complete', { assetId: uid(7), filename: 'x.png' })).body.code).toBe(
          'upload_not_found',
        );

        const signed = await post('/assets/upload-url', { filename: 'twice.png', sizeBytes: 100 });
        await put(signed.body, await png(2, 2));
        expect((await post('/assets/complete', { assetId: signed.body.assetId, filename: 'twice.png' })).status).toBe(
          201,
        );
        expect(
          (await post('/assets/complete', { assetId: signed.body.assetId, filename: 'twice.png' })).body.code,
        ).toBe('asset_exists');
      });

      it('sanitises SVG once the space allows it', async () => {
        await db.serviceDb
          .update(spaces)
          .set({ settings: { media: { allowSvg: true } } })
          .where(eq(spaces.id, spaceId));
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5" onload="alert(1)"><script>alert(2)</script><rect width="10" height="5"/></svg>';
        const res = await upload('logo.svg', Buffer.from(svg));
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body).toMatchObject({ mime: 'image/svg+xml', width: 10, height: 5 });

        const storage = createClient(
          process.env['SUPABASE_URL'] as string,
          process.env['SUPABASE_SERVICE_ROLE_KEY'] as string,
        ).storage;
        const stored = await storage.from('media').download(`spaces/${spaceId}/${res.body.id}/logo.svg`);
        const text = await (stored.data as Blob).text();
        expect(text).toContain('<rect');
        expect(text).not.toMatch(/alert|onload|script/);
        await db.serviceDb.update(spaces).set({ settings: {} }).where(eq(spaces.id, spaceId));
      });
    });

    describe('browsing and describing', () => {
      let mine: AssetDetail;
      let theirs: AssetDetail;

      beforeAll(async () => {
        mine = (
          await upload(
            'red door.jpg',
            await sharp(await png(30, 20))
              .jpeg()
              .toBuffer(),
            author,
          )
        ).body;
        theirs = (await upload('menu.pdf', Buffer.from('%PDF-1.7\n%%EOF'), editor, { folder: 'Docs', tags: ['menu'] }))
          .body;
      });

      it('lists newest first, and filters by search, folder, tag, kind and ids', async () => {
        const all: Asset[] = (await get('/assets', viewer)).body;
        expect(all[0].id).toBe(theirs.id);
        const ids = (query: string) => get(`/assets?${query}`, viewer).then((res) => res.body.map((a: Asset) => a.id));
        expect(await ids('search=RED%20DOOR')).toEqual([mine.id]);
        expect(await ids('search=menu')).toEqual([theirs.id]);
        expect(await ids('folder=Docs')).toEqual([theirs.id]);
        expect(await ids('folder=People')).toHaveLength(1);
        expect(await ids('tag=menu')).toEqual([theirs.id]);
        expect(await ids('kind=file')).toEqual([theirs.id]);
        expect(await ids(`ids=${mine.id},${theirs.id}`)).toEqual([theirs.id, mine.id]);
        expect((await get('/assets/folders', viewer)).body).toEqual([
          { folder: 'Docs', count: 1 },
          { folder: 'People/Team', count: 1 },
        ]);
      });

      it("an author describes their own upload, including its focal point, but not someone else's", async () => {
        const res = await patch(
          `/assets/${mine.id}`,
          { alt: 'A red front door', focal: { x: 0.25, y: 0.75 }, tags: ['Doors'] },
          author,
        );
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ alt: 'A red front door', focal: { x: 0.25, y: 0.75 }, tags: ['doors'] });

        const other = await patch(`/assets/${theirs.id}`, { alt: 'Menu' }, author);
        expect(other.status).toBe(403);
        expect(other.body.code).toBe('insufficient_role');
        expect((await patch(`/assets/${theirs.id}`, { focal: { x: 0.5, y: 0.5 } })).body.code).toBe('not_an_image');
      });
    });

    describe('alt text at publish, usages and the image route', () => {
      let photo: AssetDetail;
      let pdf: AssetDetail;
      let entry: Entry;

      beforeAll(async () => {
        photo = (await upload('hero.png', await png(120, 80), editor)).body;
        pdf = (await upload('price-list.pdf', Buffer.from('%PDF-1.4\n%%EOF'), editor)).body;
      });

      it('refuses a kind of file the field does not take, even in a draft', async () => {
        const res = await post('/environments/main/entries', {
          contentType: 'article',
          data: { title: 'Wrong', slug: 'wrong', doc: { assetId: photo.id } },
        });
        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual({ 'doc.assetId': ['Choose a file.'] });
      });

      it('saves a draft without alt text, but will not publish it until the image has some', async () => {
        const created = await post('/environments/main/entries', {
          contentType: 'article',
          data: { title: 'Hero page', slug: 'hero-page', image: { assetId: photo.id }, doc: { assetId: pdf.id } },
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        entry = created.body;

        const refused = await post(`/environments/main/entries/${entry.id}/publish`);
        expect(refused.status).toBe(400);
        expect(refused.body.errors).toEqual({ 'image.alt': ['Describe the image for people who cannot see it.'] });

        // The library's alt text counts, so the page needs no text of its own.
        await patch(`/assets/${photo.id}`, { alt: 'Sunrise over the bay' });
        const published = await post(`/environments/main/entries/${entry.id}/publish`);
        expect(published.status, JSON.stringify(published.body)).toBe(200);
      });

      it('records where the files are used, for the "in use" warning', async () => {
        const res = await get(`/assets/${photo.id}`, viewer);
        expect(res.body).toMatchObject({
          usageCount: 1,
          usages: [{ entryId: entry.id, title: 'Hero page', path: '/hero-page', fieldPath: 'image' }],
        });
        const list: Asset[] = (await get(`/assets?ids=${pdf.id}`)).body;
        expect(list[0].usageCount).toBe(1);
      });

      it('serves published files with long-lived cache headers, and nothing else', async () => {
        const res = await request(server()).get(`/v1/assets/${photo.id}/hero.png?v=1&width=40`).buffer(true);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['cache-control']).toContain('immutable');
        expect(res.headers['cache-tag']).toBe(`asset:${photo.id}`);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        // Transformations are off locally, so the original comes back.
        expect((await sharp(res.body).metadata()).width).toBe(120);

        expect((await request(server()).get(`/v1/assets/${photo.id}/other.png`)).status).toBe(404);
        const unused = (await get(`/assets?search=red%20door`)).body[0] as Asset;
        expect((await request(server()).get(`/v1/assets/${unused.id}/${unused.filename}`)).status).toBe(404);
        const old = await request(server()).get(`/v1/assets/${pdf.id}/price-list.pdf`);
        expect(old.status).toBe(200);
        expect(old.headers['cache-control']).toBe('public, max-age=300, s-maxage=300');
      });

      it('an editor replaces the file and keeps the id; pages show the new one', async () => {
        events.length = 0;
        expect(
          (await post(`/assets/${photo.id}/replace-url`, { filename: 'brochure.pdf', sizeBytes: 10 })).body.code,
        ).toBe('kind_mismatch');

        const signed = await post(`/assets/${photo.id}/replace-url`, { filename: 'hero-wide.png', sizeBytes: 100 });
        expect(signed.body.assetId).toBe(photo.id);
        await put(signed.body, await png(200, 50, '#00c'));
        const res = await post(`/assets/${photo.id}/replace`, { filename: 'hero-wide.png' });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body).toMatchObject({
          id: photo.id,
          filename: 'hero-wide.png',
          width: 200,
          height: 50,
          revision: 2,
          alt: 'Sunrise over the bay',
        });
        expect(await audit(photo.id)).toContain('asset.replaced');
        expect(events).toEqual([
          expect.objectContaining({ type: 'asset.replaced', assetId: photo.id, cacheTags: [`asset:${photo.id}`] }),
        ]);

        const served = await request(server()).get(`/v1/assets/${photo.id}/hero-wide.png?v=2`).buffer(true);
        expect((await sharp(served.body).metadata()).width).toBe(200);
        expect((await request(server()).get(`/v1/assets/${photo.id}/hero.png`)).status).toBe(404);
      });

      it('the bin: the file leaves the site and publishing refuses it until it is restored', async () => {
        expect((await del(`/assets/${photo.id}`, author)).status).toBe(403);
        expect((await del(`/assets/${photo.id}`)).status).toBe(204);
        expect((await get('/assets?deleted=true')).body.map((a: Asset) => a.id)).toEqual([photo.id]);
        expect((await request(server()).get(`/v1/assets/${photo.id}/hero-wide.png`)).status).toBe(404);
        expect(await audit(photo.id)).toContain('asset.deleted');

        const refused = await post(`/environments/main/entries/${entry.id}/publish`);
        expect(refused.body.errors).toEqual({
          'image.assetId': ['This file is no longer in the media library. Choose another.'],
        });

        const restored = await post(`/assets/${photo.id}/restore`);
        expect(restored.body.deletedAt).toBeNull();
        expect((await post(`/environments/main/entries/${entry.id}/publish`)).status).toBe(200);
      });

      it('unpublishing clears the usages and the files leave the site', async () => {
        await post(`/environments/main/entries/${entry.id}/unpublish`);
        expect(await db.serviceDb.select().from(assetUsages).where(eq(assetUsages.entryId, entry.id))).toEqual([]);
        expect((await request(server()).get(`/v1/assets/${pdf.id}/price-list.pdf`)).status).toBe(404);
      });
    });

    describe('another space', () => {
      it('a member of the demo space cannot list this library through the API', async () => {
        const outsider = await token(clientId, [{ id: demoSpaceId, role: 'admin' }]);
        const res = await request(server()).get(`${base()}/assets`).auth(outsider, { type: 'bearer' });
        expect(res.status).toBe(403);
      });

      it.skipIf(!process.env['SUPABASE_JWT_SECRET'])(
        'nor read its files from storage, which members of this space can',
        async () => {
          const asset = (await get('/assets?kind=image')).body[0] as Asset;
          const path = `spaces/${spaceId}/${asset.id}/${asset.filename}`;
          const as = async (spacesClaim: { id: string; role: string }[]) => {
            const jwt = await token(clientId, spacesClaim, process.env['SUPABASE_JWT_SECRET']);
            const client = createClient(
              process.env['SUPABASE_URL'] as string,
              process.env['SUPABASE_ANON_KEY'] as string,
              {
                global: { headers: { Authorization: `Bearer ${jwt}` } },
                auth: { persistSession: false },
              },
            );
            return client.storage.from('media').download(path);
          };
          const outsider = await as([{ id: demoSpaceId, role: 'admin' }]);
          expect(outsider.data).toBeNull();
          const member = await as([{ id: spaceId, role: 'viewer' }]);
          expect(member.error).toBeNull();
          expect(member.data?.size).toBeGreaterThan(0);

          const upload = await (async () => {
            const jwt = await token(clientId, [{ id: spaceId, role: 'admin' }], process.env['SUPABASE_JWT_SECRET']);
            const client = createClient(
              process.env['SUPABASE_URL'] as string,
              process.env['SUPABASE_ANON_KEY'] as string,
              {
                global: { headers: { Authorization: `Bearer ${jwt}` } },
                auth: { persistSession: false },
              },
            );
            return client.storage
              .from('media')
              .upload(`spaces/${spaceId}/${uid(5)}/direct.png`, await png(2, 2), { contentType: 'image/png' });
          })();
          expect(upload.error).not.toBeNull();
        },
      );
    });
  });
});
