import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { auditEvents, DbService, spaces } from '@novan/api-db';
import { JobHandlers } from '@novan/api-jobs';
import type { CreateDesignSystemVersionResponse, DesignSystem, DesignSystemVersion, SiteStyles } from '@novan/shared-schemas';
import { createClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// The storage-backed block needs the local Supabase stack (`npm run db:start && npm run db:reset`) and the keys in
// .env.local: uploads go to the real `design-systems` bucket. The worker's job is run directly.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasStorage = Boolean(
  process.env['DATABASE_URL'] && process.env['SUPABASE_URL'] && process.env['SUPABASE_SERVICE_ROLE_KEY'] && process.env['SUPABASE_ANON_KEY'],
);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
// Seeded users (supabase/seed.sql).
const agencyId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const novanAdminId = '00000000-0000-4000-8000-000000000003';
const organisationId = '00000000-0000-4000-8000-000000000100';
const demoSpaceId = '00000000-0000-4000-8000-000000000200';

function token(sub: string, spaceClaims: { id: string; role: string }[]): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: 'aal1', spaces: spaceClaims, agency_staff: false, sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const STYLESHEET = `
.btn { display: inline-block }
.btn-primary { color: #fff !important }
.text-center { text-align: center }
.evil { background: url("javascript:alert(1)") }
`;

describe('design systems API', () => {
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

  describe('guards and validation', () => {
    it.each([
      ['editor', 'post', '/design-systems'],
      ['editor', 'post', `/design-systems/${uid(1)}/versions`],
      ['viewer', 'post', `/design-systems/${uid(1)}/versions/${uid(2)}/complete`],
      ['author', 'post', `/design-systems/${uid(1)}/versions/${uid(2)}/deprecate`],
      ['editor', 'put', '/site/design-systems'],
    ] as const)('answers 403 when a %s calls %s %s', async (role, method, path) => {
      const res = await request(app.getHttpServer())
        [method](`/v1/management/spaces/${demoSpaceId}${path}`)
        .auth(await token(clientId, [{ id: demoSpaceId, role }]), { type: 'bearer' })
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('insufficient_role');
    });

    it('checks what a new version is', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/management/spaces/${demoSpaceId}/design-systems/${uid(1)}/versions`)
        .auth(await token(clientId, [{ id: demoSpaceId, role: 'admin' }]), { type: 'bearer' })
        .send({ source: 'url', version: '1.0.0', url: 'http://cdn.example.com/a.css' });
      expect(res.status).toBe(400);
      expect(res.body.errors['url']).toEqual(['Use an https address.']);
    });

    it('serves no file for a made-up version or path', async () => {
      expect((await request(app.getHttpServer()).get(`/v1/design-system-files/${uid(1)}/a.css`)).status).toBe(404);
      expect((await request(app.getHttpServer()).get(`/v1/design-system-files/${uid(1)}/..%2F..%2Fsecret.css`)).status).toBe(404);
      expect((await request(app.getHttpServer()).get('/v1/design-system-files/not-an-id/a.css')).status).toBe(400);
    });
  });

  describe.skipIf(!hasStorage)('with the database and storage (RLS applies)', () => {
    const run = Date.now();
    let db: DbService;
    let spaceA: string;
    let spaceB: string;
    let adminA: string;
    let developerA: string;
    let editorA: string;
    let adminB: string;

    const server = () => app.getHttpServer();
    const call = (spaceId: string, as: string) => ({
      get: (path: string) => request(server()).get(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }),
      post: (path: string, body: object = {}) => request(server()).post(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }).send(body),
      put: (path: string, body: object) => request(server()).put(`/v1/management/spaces/${spaceId}${path}`).auth(as, { type: 'bearer' }).send(body),
    });
    const runWorker = (spaceId: string, versionId: string) =>
      app.get(JobHandlers).find('design-systems', 'process-version')?.(
        { type: 'process-version', spaceId, versionId },
        { queue: 'design-systems', msgId: '1', attempt: 1, final: false, enqueuedAt: new Date().toISOString() },
      );
    const enable = (spaceId: string) =>
      db.serviceDb
        .update(spaces)
        .set({ settings: sql`${spaces.settings} || '{"designSystems": {"enabled": true}}'::jsonb` })
        .where(eq(spaces.id, spaceId));

    /** Uploads a stylesheet as a new version, completes it and runs the worker. */
    async function upload(designSystemId: string, version: string, css: string): Promise<DesignSystemVersion> {
      const started = await call(spaceA, developerA).post(`/design-systems/${designSystemId}/versions`, { source: 'css', version, filename: 'acme.css' });
      expect(started.status, JSON.stringify(started.body)).toBe(201);
      const body = started.body as CreateDesignSystemVersionResponse;
      const put = await fetch(body.uploadUrl as string, { method: 'PUT', headers: { 'content-type': 'text/css' }, body: css });
      expect(put.status, await put.clone().text()).toBe(200);
      const completed = await call(spaceA, developerA).post(`/design-systems/${designSystemId}/versions/${body.version.id}/complete`);
      expect(completed.status).toBe(200);
      expect(completed.body.status).toBe('validating');
      await runWorker(spaceA, body.version.id);
      return (await call(spaceA, developerA).get(`/design-systems/${designSystemId}/versions/${body.version.id}`)).body;
    }

    beforeAll(async () => {
      db = app.get(DbService);
      const created = await db.serviceDb
        .insert(spaces)
        .values([
          { organisationId, name: 'Design systems A', slug: `design-systems-a-${run}` },
          { organisationId, name: 'Design systems B', slug: `design-systems-b-${run}` },
        ])
        .returning({ id: spaces.id });
      [spaceA, spaceB] = created.map((row) => row.id);
      adminA = await token(novanAdminId, [{ id: spaceA, role: 'admin' }]);
      developerA = await token(agencyId, [{ id: spaceA, role: 'developer' }]);
      editorA = await token(clientId, [{ id: spaceA, role: 'editor' }]);
      adminB = await token(novanAdminId, [{ id: spaceB, role: 'admin' }]);
    });

    afterAll(async () => {
      if (!spaceA) return;
      const storage = createClient(process.env['SUPABASE_URL'] as string, process.env['SUPABASE_SERVICE_ROLE_KEY'] as string).storage;
      for (const spaceId of [spaceA, spaceB]) {
        const paths: string[] = [];
        const walk = async (prefix: string) => {
          for (const item of (await storage.from('design-systems').list(prefix, { limit: 1000 })).data ?? []) {
            if (item.id) paths.push(`${prefix}/${item.name}`);
            else await walk(`${prefix}/${item.name}`);
          }
        };
        await walk(`spaces/${spaceId}`);
        if (paths.length) await storage.from('design-systems').remove(paths);
      }
      await db.serviceDb.delete(spaces).where(sql`${spaces.id} in (${spaceA}, ${spaceB})`);
    });

    it('stays off until the agency turns it on for the space', async () => {
      const res = await call(spaceA, adminA).post('/design-systems', { name: 'Acme', slug: 'acme', framework: 'bootstrap' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('design_systems_off');
      await enable(spaceA);
      await enable(spaceB);
    });

    let acme: DesignSystem;
    let ready: DesignSystemVersion;

    it('lets admins add a design system, once per short name', async () => {
      const res = await call(spaceA, adminA).post('/design-systems', { name: 'Acme', slug: 'acme', framework: 'bootstrap' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      acme = res.body;
      const again = await call(spaceA, developerA).post('/design-systems', { name: 'Acme 2', slug: 'acme', framework: 'css' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('design_system_exists');
    });

    it('checks an uploaded stylesheet: ready, with what it removed and the classes it has', async () => {
      ready = await upload(acme.id, '1.0.0', STYLESHEET);
      expect(ready.status).toBe('ready');
      expect(ready.report?.errors).toEqual([]);
      expect(ready.report?.warnings.map((warning) => warning.message)).toEqual([
        'background was removed: it links to javascript: addresses.',
        '1 declaration uses !important, which beats the classes editors add to blocks.',
      ]);
      expect(ready.report?.classes).toBe(4);

      const classes = await call(spaceA, editorA).get(`/design-systems/${acme.id}/versions/${ready.id}/classes?q=btn`);
      expect(classes.status).toBe(200);
      expect(classes.body.items).toEqual([
        { name: 'btn', group: 'buttons' },
        { name: 'btn-primary', group: 'buttons' },
      ]);
      expect(classes.body.total).toBe(4);
      expect(classes.body.groups).toContainEqual({ group: 'typography', count: 1 });

      const actions = await db.serviceDb
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, spaceA), eq(auditEvents.targetId, ready.id)));
      expect(actions.map((row) => row.action).sort()).toEqual(['design_system.version_ready', 'design_system.version_uploaded']);
    });

    it('refuses a version number twice', async () => {
      const res = await call(spaceA, developerA).post(`/design-systems/${acme.id}/versions`, { source: 'css', version: '1.0.0', filename: 'acme.css' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('version_exists');
    });

    it('marks a stylesheet that cannot be read invalid, with the line', async () => {
      const invalid = await upload(acme.id, '1.0.1', '.a { color: red }\n.b {');
      expect(invalid.status).toBe('invalid');
      expect(invalid.report?.errors).toEqual([{ file: 'acme.css', line: 2, message: 'The stylesheet cannot be read: Unclosed block.' }]);
    });

    it('never fetches from the API’s own network', async () => {
      const res = await call(spaceA, developerA).post(`/design-systems/${acme.id}/versions`, {
        source: 'url',
        version: '2.0.0',
        url: 'https://127.0.0.1:54321/storage/v1/object/public/x.css',
      });
      expect(res.status).toBe(201);
      expect(res.body.uploadUrl).toBeNull();
      expect(res.body.version.status).toBe('validating');
      await runWorker(spaceA, res.body.version.id);
      const version = (await call(spaceA, developerA).get(`/design-systems/${acme.id}/versions/${res.body.version.id}`)).body;
      expect(version.status).toBe('invalid');
      expect(version.report.errors).toEqual([{ message: '127.0.0.1 is not a public address.' }]);
    });

    it('keeps other spaces out', async () => {
      expect((await call(spaceB, adminB).get('/design-systems')).body).toEqual([]);
      const res = await call(spaceB, adminB).get(`/design-systems/${acme.id}/versions/${ready.id}`);
      expect(res.status).toBe(404);
      const attach = await call(spaceB, adminB).put('/site/design-systems', { items: [{ versionId: ready.id }] });
      expect(attach.status).toBe(404);
      expect(attach.body.code).toBe('version_not_found');
    });

    it('serves files only once the site loads them, then tells the site to load them', async () => {
      const file = `/v1/design-system-files/${ready.id}/acme.css`;
      expect((await request(server()).get(file)).status).toBe(404);

      const invalidAttach = await call(spaceA, adminA).put('/site/design-systems', { items: [{ versionId: (await call(spaceA, adminA).get('/design-systems')).body[0].versions.find((v: DesignSystemVersion) => v.status === 'invalid').id }] });
      expect(invalidAttach.status).toBe(409);
      expect(invalidAttach.body.code).toBe('version_not_ready');

      const attached = await call(spaceA, adminA).put('/site/design-systems', { items: [{ versionId: ready.id, enabled: true }] });
      expect(attached.status, JSON.stringify(attached.body)).toBe(200);
      expect(attached.body).toMatchObject([{ versionId: ready.id, slug: 'acme', framework: 'bootstrap', loadOrder: 0, enabled: true }]);

      const served = await request(server()).get(file);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('text/css; charset=utf-8');
      expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(served.headers['access-control-allow-origin']).toBe('*');
      expect(served.text.startsWith('@layer novan-base, ds-vendor, ds-components, novan-overrides;\n@layer ds-vendor {')).toBe(true);
      expect(served.text).not.toContain('javascript');

      const delivery = (await call(spaceA, developerA).post('/api-tokens', { name: 'Website', scope: 'delivery' })).body;
      const styles = await request(server()).get('/v1/delivery/site-styles').auth(delivery.token, { type: 'bearer' });
      expect(styles.status).toBe(200);
      const body = styles.body as SiteStyles;
      expect(body.layers).toBe('@layer novan-base, ds-vendor, ds-components, novan-overrides;');
      expect(body.stylesheets).toEqual([{ href: expect.stringMatching(new RegExp(`/v1/design-system-files/${ready.id}/acme\\.css$`)), designSystem: 'acme', version: '1.0.0' }]);
      expect(body.adapter).toEqual({ framework: 'bootstrap' });
      expect(styles.headers['cache-tag']).toContain('site-styles:');
    });

    it('takes one version of each design system, and detaches what is left out', async () => {
      const second = await upload(acme.id, '1.1.0', '.card { padding: 1rem }');
      const both = await call(spaceA, adminA).put('/site/design-systems', { items: [{ versionId: ready.id }, { versionId: second.id }] });
      expect(both.status).toBe(409);
      expect(both.body.code).toBe('one_version_each');
      const swapped = await call(spaceA, adminA).put('/site/design-systems', { items: [{ versionId: second.id }] });
      expect(swapped.body.map((item: { version: string }) => item.version)).toEqual(['1.1.0']);
      expect((await request(server()).get(`/v1/design-system-files/${ready.id}/acme.css`)).status).toBe(404);
      const cleared = await call(spaceA, adminA).put('/site/design-systems', { items: [] });
      expect(cleared.body).toEqual([]);
    });

    it('deprecates a ready version, which can stay attached but not be added again', async () => {
      const site = await call(spaceA, adminA).put('/site/design-systems', { items: [{ versionId: ready.id }] });
      expect(site.status).toBe(200);
      const deprecated = await call(spaceA, developerA).post(`/design-systems/${acme.id}/versions/${ready.id}/deprecate`);
      expect(deprecated.body.status).toBe('deprecated');
      expect((await call(spaceA, adminA).put('/site/design-systems', { items: [{ versionId: ready.id, enabled: false }] })).status).toBe(200);
      await call(spaceA, adminA).put('/site/design-systems', { items: [] });
      const again = await call(spaceA, adminA).put('/site/design-systems', { items: [{ versionId: ready.id }] });
      expect(again.status).toBe(409);
    });
  });
});
