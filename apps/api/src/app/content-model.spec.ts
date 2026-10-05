import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { ENTRY_SOURCE, type EntrySource, type StoredEntry } from '@novan/api-content-model';
import { auditEvents, blockTypes, contentTypes, DbService, publishedContent, spaces } from '@novan/api-db';
import { blockTypeSchema, buildEntrySchema, contentTypeSchema, type FieldDef } from '@novan/shared-schemas';
import { and, eq, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// The DB-backed block needs the local Supabase database (`npm run db:start && npm run db:reset`).
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';

// Seeded fixture (supabase/seed.sql).
const agencyId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const organisationId = '00000000-0000-4000-8000-000000000100';
const demoSpaceId = '00000000-0000-4000-8000-000000000200';
const otherSpaceId = '00000000-0000-4000-8000-0000000002ff';

function token(sub: string, spaces: { id: string; role: string }[], staff = false): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: staff ? 'aal2' : 'aal1', spaces, agency_staff: staff })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

const as = (role: string, spaceId = demoSpaceId) => token(clientId, [{ id: spaceId, role }]);
const base = (spaceId: string, what: 'content-types' | 'block-types', env = 'main') =>
  `/v1/management/spaces/${spaceId}/environments/${env}/${what}`;

/** Entries the content model checks against; package 06 supplies real ones. */
const entrySource: EntrySource & { entries: StoredEntry[] } = {
  entries: [],
  list(_tx, _environmentId, contentTypeIds) {
    return Promise.resolve(this.entries.filter((e) => !contentTypeIds || contentTypeIds.includes(e.contentTypeId)));
  },
};

describe('content model API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(ENTRY_SOURCE)
      .useValue(entrySource)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('guards and validation', () => {
    it.each([
      ['editor', 'post', 'content-types', ''],
      ['author', 'patch', 'content-types', '/page'],
      ['viewer', 'delete', 'block-types', '/hero'],
      ['editor', 'post', 'block-types', ''],
    ] as const)('answers 403 when an %s calls %s %s', async (role, method, what, suffix) => {
      const res = await request(app.getHttpServer())
        [method](`${base(demoSpaceId, what)}${suffix}`)
        .auth(await as(role), { type: 'bearer' })
        .send({ name: 'x' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('insufficient_role');
    });

    it('answers 403 for a space the caller is not a member of', async () => {
      const res = await request(app.getHttpServer())
        .get(base(otherSpaceId, 'content-types'))
        .auth(await as('developer'), { type: 'bearer' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('space_forbidden');
    });

    it('validates field definitions with the shared schema', async () => {
      const res = await request(app.getHttpServer())
        .post(base(demoSpaceId, 'content-types'))
        .auth(await as('developer'), { type: 'bearer' })
        .send({ apiId: 'post', name: 'Post', kind: 'entry', fields: [{ id: 'a', apiId: 'title', label: 'Title', type: 'colour' }] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
      expect(res.body.errors).toHaveProperty(['fields.0.type']);
    });

    it('refuses to change the api id, and an unknown force value', async () => {
      const server = app.getHttpServer();
      const developer = await as('developer');

      const rename = await request(server).patch(`${base(demoSpaceId, 'content-types')}/page`).auth(developer, { type: 'bearer' }).send({ apiId: 'pages' });
      const force = await request(server)
        .patch(`${base(demoSpaceId, 'content-types')}/page?force=yes`)
        .auth(developer, { type: 'bearer' })
        .send({ name: 'Page' });

      expect(rename.status).toBe(400);
      expect(force.status).toBe(400);
    });
  });

  describe.skipIf(!hasDatabase)('with the database (RLS applies)', () => {
    const run = Date.now();
    const blockApiId = `testBlock${run}`;
    const typeApiId = `testType${run}`;
    let db: DbService;
    let spaceId: string;
    let developer: string;

    beforeAll(async () => {
      db = app.get(DbService);
      // A throwaway space (the insert trigger adds `main` and the roles) keeps audit rows out of the demo space.
      const [space] = await db.serviceDb
        .insert(spaces)
        .values({ organisationId, name: 'Content model test', slug: `content-model-${run}` })
        .returning({ id: spaces.id });
      spaceId = space.id;
      developer = await as('developer', spaceId);
    });

    afterEach(() => {
      entrySource.entries = [];
    });

    afterAll(async () => {
      if (spaceId) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceId));
    });

    it('an editor reads the seeded page type, singletons and five block types, stored as the API would store them', async () => {
      const editor = await as('editor');
      const types = await request(app.getHttpServer()).get(base(demoSpaceId, 'content-types')).auth(editor, { type: 'bearer' });
      const blocks = await request(app.getHttpServer()).get(base(demoSpaceId, 'block-types')).auth(editor, { type: 'bearer' });

      expect(types.status).toBe(200);
      expect(types.body.map((t: { apiId: string }) => t.apiId).sort()).toEqual(['navigation', 'notFound', 'page', 'siteSettings']);
      expect(blocks.body.map((b: { apiId: string }) => b.apiId).sort()).toEqual(['cta', 'featureGrid', 'hero', 'image', 'richText']);
      // Parsing fills every default, so equality proves the seed is valid and already canonical.
      for (const type of types.body) expect(contentTypeSchema.parse(type)).toEqual(type);
      for (const block of blocks.body) expect(blockTypeSchema.parse(block)).toEqual(block);
      const page = types.body.find((t: { apiId: string }) => t.apiId === 'page');
      expect(page.fields.find((f: { apiId: string }) => f.apiId === 'body').allowedBlocks).toEqual([
        'hero',
        'richText',
        'image',
        'featureGrid',
        'cta',
      ]);
    });

    it('seeds published pages and singletons that pass publish validation unchanged', async () => {
      const [types, blocks, published] = await Promise.all([
        db.serviceDb.select().from(contentTypes).where(eq(contentTypes.spaceId, demoSpaceId)),
        db.serviceDb.select().from(blockTypes).where(eq(blockTypes.spaceId, demoSpaceId)),
        db.serviceDb.select().from(publishedContent).where(eq(publishedContent.spaceId, demoSpaceId)),
      ]);
      const blockDefs = blocks.map((block) => ({
        apiId: block.apiId,
        fields: block.fields as FieldDef[],
        allowedChildren: block.allowedChildren,
      }));

      expect(published.map((row) => row.fullPath).sort()).toEqual(['/about', '/contact', '/home', '/navigation', '/not-found', '/site-settings']);
      for (const row of published) {
        const type = types.find((candidate) => candidate.apiId === row.contentTypeApiId);
        const schema = buildEntrySchema((type?.fields ?? []) as FieldDef[], { blockTypes: blockDefs });
        expect(schema.parse(row.data), row.fullPath).toEqual(row.data);
      }
    });

    it('answers 404 for an unknown environment or type', async () => {
      const editor = await as('editor');
      const env = await request(app.getHttpServer()).get(base(demoSpaceId, 'content-types', 'nope')).auth(editor, { type: 'bearer' });
      const type = await request(app.getHttpServer()).get(`${base(demoSpaceId, 'block-types')}/nope`).auth(editor, { type: 'bearer' });

      expect(env.status).toBe(404);
      expect(env.body.code).toBe('environment_not_found');
      expect(type.status).toBe(404);
      expect(type.body.code).toBe('block_type_not_found');
    });

    it('a developer models a block type and a content type that uses it, each change audited', async () => {
      const server = app.getHttpServer();

      const block = await request(server)
        .post(base(spaceId, 'block-types'))
        .auth(developer, { type: 'bearer' })
        .send({
          apiId: blockApiId,
          name: 'Test block',
          icon: 'box',
          fields: [{ id: 'h', apiId: 'heading', label: 'Heading', type: 'text' }],
          styleOptions: { tone: { kind: 'radio', label: 'Tone', options: [{ value: 'light', label: 'Light' }], default: 'light' } },
        });
      expect(block.status).toBe(201);
      expect(block.body).toMatchObject({ apiId: blockApiId, schemaVersion: 1, allowedChildren: [] });

      const type = await request(server)
        .post(base(spaceId, 'content-types'))
        .auth(developer, { type: 'bearer' })
        .send({
          apiId: typeApiId,
          name: 'Test type',
          kind: 'entry',
          fields: [
            { id: 't', apiId: 'title', label: 'Title', type: 'text' },
            { id: 'b', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: [blockApiId] },
            // A type may refer to itself.
            { id: 'r', apiId: 'related', label: 'Related', type: 'reference', contentTypes: [typeApiId], multiple: true },
          ],
        });
      expect(type.status).toBe(201);
      expect(type.body.fields[0]).toMatchObject({ required: false, localised: false, multiline: false });

      const again = await request(server)
        .post(base(spaceId, 'content-types'))
        .auth(developer, { type: 'bearer' })
        .send({ apiId: typeApiId, name: 'Again', kind: 'entry' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('api_id_taken');

      const renamed = await request(server)
        .patch(`${base(spaceId, 'content-types')}/${typeApiId}`)
        .auth(developer, { type: 'bearer' })
        .send({ name: 'Renamed type', description: 'For tests.' });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ name: 'Renamed type', description: 'For tests.' });

      const audit = await db.serviceDb.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.spaceId, spaceId));
      expect(audit.map((a) => a.action).sort()).toEqual(['block_type.created', 'content_type.created', 'content_type.updated']);
    });

    it('rejects references to types that do not exist', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${base(spaceId, 'content-types')}/${typeApiId}`)
        .auth(developer, { type: 'bearer' })
        .send({ fields: [{ id: 'b', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: ['gallery'] }] });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'unknown_reference',
        errors: { 'fields.0.allowedBlocks.0': ['There is no block type "gallery" in this environment.'] },
      });
    });

    it('raises a block type\'s schema version only when its schema changes', async () => {
      const server = app.getHttpServer();
      const url = `${base(spaceId, 'block-types')}/${blockApiId}`;

      const renamed = await request(server).patch(url).auth(developer, { type: 'bearer' }).send({ name: 'Test block renamed' });
      // Same style options with the keys in another order.
      const same = await request(server)
        .patch(url)
        .auth(developer, { type: 'bearer' })
        .send({ styleOptions: { tone: { default: 'light', options: [{ label: 'Light', value: 'light' }], label: 'Tone', kind: 'radio' } } });
      const changed = await request(server)
        .patch(url)
        .auth(developer, { type: 'bearer' })
        .send({ styleOptions: { tone: { kind: 'select', label: 'Tone', options: [{ value: 'light', label: 'Light' }], default: 'light' } } });

      expect([renamed.body.schemaVersion, same.body.schemaVersion, changed.body.schemaVersion]).toEqual([1, 1, 2]);
    });

    it('refuses a field change that invalidates entries unless forced, and reports how many', async () => {
      const server = app.getHttpServer();
      const url = `${base(spaceId, 'content-types')}/${typeApiId}`;
      const current = await request(server).get(url).auth(developer, { type: 'bearer' });
      entrySource.entries = [
        { id: 'e1', contentTypeId: current.body.id, data: { title: 'Has a title' } },
        { id: 'e2', contentTypeId: current.body.id, data: {} },
      ];
      const fields = current.body.fields.map((f: { apiId: string }) => (f.apiId === 'title' ? { ...f, required: true } : f));

      const refused = await request(server).patch(url).auth(developer, { type: 'bearer' }).send({ fields });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'entries_invalidated', affectedEntries: 1 });
      expect(refused.body.detail).toContain('1 existing entry');

      const forced = await request(server).patch(`${url}?force=true`).auth(developer, { type: 'bearer' }).send({ fields });
      expect(forced.status).toBe(200);
      expect(forced.body.fields[0].required).toBe(true);

      const forcedAudit = await db.serviceDb
        .select({ diff: auditEvents.diff })
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, spaceId), sql`${auditEvents.diff} ? 'affectedEntries'`));
      expect(forcedAudit.map((a) => a.diff)).toEqual([expect.objectContaining({ apiId: typeApiId, affectedEntries: 1 })]);
    });

    it('refuses to delete a block type that is still allowed somewhere, then deletes both types', async () => {
      const server = app.getHttpServer();

      const inUse = await request(server).delete(`${base(spaceId, 'block-types')}/${blockApiId}`).auth(developer, { type: 'bearer' });
      expect(inUse.status).toBe(409);
      expect(inUse.body.code).toBe('block_type_in_use');
      expect(inUse.body.detail).toContain(typeApiId);

      const type = await request(server).delete(`${base(spaceId, 'content-types')}/${typeApiId}`).auth(developer, { type: 'bearer' });
      const block = await request(server).delete(`${base(spaceId, 'block-types')}/${blockApiId}`).auth(developer, { type: 'bearer' });
      expect([type.status, block.status]).toEqual([204, 204]);

      const gone = await request(server).get(base(spaceId, 'content-types')).auth(developer, { type: 'bearer' });
      expect(gone.body).toEqual([]);
    });

    it('agency staff model any space; an admin of another space cannot read this one', async () => {
      const staff = await token(agencyId, [], true);
      const created = await request(app.getHttpServer())
        .post(base(spaceId, 'block-types'))
        .auth(staff, { type: 'bearer' })
        .send({ apiId: 'staffBlock', name: 'Staff block' });
      expect(created.status).toBe(201);

      // The guard and RLS read the same claim: membership of the demo space gives nothing here.
      const outsider = await token(agencyId, [{ id: demoSpaceId, role: 'admin' }]);
      const res = await request(app.getHttpServer()).get(base(spaceId, 'block-types')).auth(outsider, { type: 'bearer' });
      expect(res.status).toBe(403);
      const rows = await db.userDb({ sub: agencyId, role: 'authenticated', spaces: [{ id: demoSpaceId, role: 'admin' }] }, (tx) =>
        tx.execute(`select 1 from public.block_types where space_id = '${spaceId}'`),
      );
      expect(rows).toHaveLength(0);
    });
  });
});
