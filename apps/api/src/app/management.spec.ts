import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { auditEvents, DbService, members, spaces } from '@novan/api-db';
import { and, eq, inArray } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// The DB-backed block needs the local Supabase database (`npm run db:start && npm run db:reset`).
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
// DbService connects lazily, so guard-only tests run without a database.
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';

// Seeded fixture (supabase/seed.sql).
const agencyId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const demoSpaceId = '00000000-0000-4000-8000-000000000200';
const otherSpaceId = '00000000-0000-4000-8000-0000000002ff';

interface TokenOptions {
  sub: string;
  spaces?: { id: string; role: string }[];
  agencyStaff?: boolean;
  aal?: 'aal1' | 'aal2';
  role?: string;
}

function token({
  sub,
  spaces = [],
  agencyStaff = false,
  aal = 'aal1',
  role = 'authenticated',
}: TokenOptions): Promise<string> {
  return new SignJWT({ role, aal, spaces, agency_staff: agencyStaff, email: `${sub}@example.test` })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

const clientEditor = (): Promise<string> => token({ sub: clientId, spaces: [{ id: demoSpaceId, role: 'editor' }] });
const clientViewer = (): Promise<string> => token({ sub: clientId, spaces: [{ id: demoSpaceId, role: 'viewer' }] });
const agencyStaff = (aal: 'aal1' | 'aal2' = 'aal2'): Promise<string> =>
  token({ sub: agencyId, spaces: [{ id: demoSpaceId, role: 'admin' }], agencyStaff: true, aal });

describe('management API', () => {
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

  describe('guards', () => {
    it('answers 401 problem+json without a token', async () => {
      const res = await request(app.getHttpServer()).get('/v1/management/spaces');

      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({ status: 401, code: 'missing_token' });
    });

    it('answers 401 for a token with a bad signature', async () => {
      const forged = (await clientEditor()).replace(/\.[^.]+$/, '.AAAA');
      const res = await request(app.getHttpServer()).get('/v1/management/spaces').auth(forged, { type: 'bearer' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('invalid_token');
    });

    it('answers 401 for a non-user token (anon key)', async () => {
      const anon = await token({ sub: clientId, role: 'anon' });
      const res = await request(app.getHttpServer()).get('/v1/management/spaces').auth(anon, { type: 'bearer' });

      expect(res.status).toBe(401);
    });

    it('answers 403 for a space the caller is not a member of', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/management/spaces/${otherSpaceId}/members`)
        .auth(await clientEditor(), { type: 'bearer' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('space_forbidden');
    });

    it('answers 404 for a malformed space id', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/management/spaces/not-a-uuid/members')
        .auth(await clientEditor(), { type: 'bearer' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('space_not_found');
    });

    it.each([
      ['post', `/v1/management/spaces/${demoSpaceId}/members`],
      ['patch', `/v1/management/spaces/${demoSpaceId}/members/${agencyId}`],
      ['delete', `/v1/management/spaces/${demoSpaceId}/members/${agencyId}`],
      ['post', `/v1/management/spaces/${demoSpaceId}/invites`],
    ] as const)('answers 403 when a viewer writes (%s %s)', async (method, path) => {
      const res = await request(app.getHttpServer())
        [method](path)
        .auth(await clientViewer(), { type: 'bearer' })
        .send({ role: 'admin', userId: clientId, email: 'x@example.test' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('insufficient_role');
    });

    it('answers 403 when a non-admin member manages members', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/management/spaces/${demoSpaceId}/invites`)
        .auth(await clientEditor(), { type: 'bearer' })
        .send({ email: 'x@example.test', role: 'editor' });

      expect(res.status).toBe(403);
    });

    it('answers 403 when someone other than agency staff creates a space', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/management/spaces')
        .auth(await clientEditor(), { type: 'bearer' })
        .send({ name: 'Acme Ltd', slug: 'acme' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('agency_staff_only');
    });

    it('answers 403 when a member who is not an admin changes the space settings', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/management/spaces/${demoSpaceId}`)
        .auth(await clientEditor(), { type: 'bearer' })
        .send({ name: 'Renamed' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('insufficient_role');
    });

    it('answers 403 when a viewer dismisses the onboarding checklist', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/management/spaces/${demoSpaceId}/onboarding/dismiss`)
        .auth(await clientViewer(), { type: 'bearer' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('insufficient_role');
    });

    it('only agency staff record viewing a space as a role', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/management/spaces/${demoSpaceId}/view-as`)
        .auth(await clientEditor(), { type: 'bearer' })
        .send({ role: 'viewer' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('agency_staff_only');
    });

    it('requires agency staff to complete MFA', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/management/spaces')
        .auth(await agencyStaff('aal1'), { type: 'bearer' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('mfa_required');
    });

    it('lets agency staff at AAL2 into any space', async () => {
      const staff = await token({ sub: agencyId, agencyStaff: true, aal: 'aal2' });
      const res = await request(app.getHttpServer())
        .post(`/v1/management/spaces/${otherSpaceId}/members`)
        .auth(staff, { type: 'bearer' })
        .send({});

      // Past the guards: the empty body fails validation.
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
      expect(res.body.errors).toHaveProperty('userId');
    });
  });

  describe.skipIf(!hasDatabase)('with the database (RLS applies)', () => {
    const slug = `api-test-${Date.now()}`;
    let db: DbService;
    let spaceId: string;

    beforeAll(() => {
      db = app.get(DbService);
    });

    afterAll(async () => {
      if (spaceId) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceId));
    });

    it('GET /me works at AAL1 and returns the claims', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/management/me')
        .auth(await agencyStaff('aal1'), { type: 'bearer' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: agencyId,
        displayName: 'Agency User',
        agencyStaff: true,
        aal: 'aal1',
        spaces: [{ id: demoSpaceId, role: 'admin' }],
      });
    });

    it('agency staff create a space, become its admin, and the write is audited', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/management/spaces')
        .auth(await agencyStaff(), { type: 'bearer' })
        .send({ name: 'Acme Ltd', slug });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Acme Ltd', slug, role: 'admin' });
      spaceId = res.body.id;

      const audit = await db.serviceDb
        .select({ action: auditEvents.action, actorId: auditEvents.actorId })
        .from(auditEvents)
        .where(eq(auditEvents.spaceId, spaceId));
      expect(audit).toEqual([{ action: 'space.created', actorId: agencyId }]);
    });

    it('a new space opens with an empty onboarding checklist; the seeded demo space has none', async () => {
      const staff = await agencyStaff();
      const created = await request(app.getHttpServer()).get(`/v1/management/spaces/${spaceId}/onboarding`).auth(staff, { type: 'bearer' });
      const seeded = await request(app.getHttpServer())
        .get(`/v1/management/spaces/${demoSpaceId}/onboarding`)
        .auth(await clientViewer(), { type: 'bearer' });

      expect(created.status).toBe(200);
      expect(created.body).toEqual({ checklist: { completed: {}, dismissedAt: null } });
      expect(seeded.body).toEqual({ checklist: null });
    });

    it('a space admin renames the space and sets its site address, audited', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/management/spaces/${spaceId}`)
        .auth(await agencyStaff(), { type: 'bearer' })
        .send({ name: 'Acme Limited', previewUrl: 'https://www.acme.example/' });

      expect(res.status).toBe(200);
      // The staff token was minted before the space existed, so it carries no role there.
      expect(res.body).toMatchObject({ id: spaceId, name: 'Acme Limited', previewUrl: 'https://www.acme.example', role: null });
      const [audit] = await db.serviceDb
        .select({ diff: auditEvents.diff })
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, spaceId), eq(auditEvents.action, 'space.updated')));
      expect(audit.diff).toEqual({
        name: { from: 'Acme Ltd', to: 'Acme Limited' },
        previewUrl: { from: null, to: 'https://www.acme.example' },
      });
    });

    it('refuses a site address that is not a web address', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/management/spaces/${spaceId}`)
        .auth(await agencyStaff(), { type: 'bearer' })
        .send({ previewUrl: 'javascript:alert(1)' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty('previewUrl');
    });

    it('agency staff viewing as a role is audited, and grants nothing', async () => {
      const staff = await agencyStaff();
      const start = await request(app.getHttpServer())
        .post(`/v1/management/spaces/${spaceId}/view-as`)
        .auth(staff, { type: 'bearer' })
        .send({ role: 'editor' });
      const stop = await request(app.getHttpServer())
        .post(`/v1/management/spaces/${spaceId}/view-as`)
        .auth(staff, { type: 'bearer' })
        .send({ role: null });

      expect([start.status, stop.status]).toEqual([204, 204]);
      const audit = await db.serviceDb
        .select({ action: auditEvents.action, diff: auditEvents.diff, actorId: auditEvents.actorId })
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, spaceId), inArray(auditEvents.action, ['view_as.started', 'view_as.stopped'])));
      expect(audit).toEqual(
        expect.arrayContaining([
          { action: 'view_as.started', diff: { role: 'editor' }, actorId: agencyId },
          { action: 'view_as.stopped', diff: null, actorId: agencyId },
        ]),
      );
    });

    it('rejects a duplicate slug with 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/management/spaces')
        .auth(await agencyStaff(), { type: 'bearer' })
        .send({ name: 'Acme again', slug });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('slug_taken');
    });

    it('a client sees only their own spaces', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/management/spaces')
        .auth(await clientEditor(), { type: 'bearer' });

      expect(res.status).toBe(200);
      expect(res.body.map((s: { id: string }) => s.id)).toEqual([demoSpaceId]);
    });

    it('a space admin adds, re-roles and removes a member, each audited', async () => {
      const staff = await agencyStaff();
      const server = app.getHttpServer();
      const base = `/v1/management/spaces/${spaceId}/members`;

      const added = await request(server)
        .post(base)
        .auth(staff, { type: 'bearer' })
        .send({ userId: clientId, role: 'editor' });
      expect(added.status).toBe(201);
      expect(added.body).toMatchObject({
        userId: clientId,
        role: 'editor',
        displayName: 'Client User',
        invitedBy: agencyId,
      });

      const again = await request(server)
        .post(base)
        .auth(staff, { type: 'bearer' })
        .send({ userId: clientId, role: 'editor' });
      expect(again.status).toBe(409);

      const changed = await request(server)
        .patch(`${base}/${clientId}`)
        .auth(staff, { type: 'bearer' })
        .send({ role: 'viewer' });
      expect(changed.status).toBe(200);
      expect(changed.body.role).toBe('viewer');

      const listed = await request(server).get(base).auth(staff, { type: 'bearer' });
      expect(listed.body.map((m: { userId: string; role: string }) => [m.userId, m.role])).toEqual(
        expect.arrayContaining([
          [agencyId, 'admin'],
          [clientId, 'viewer'],
        ]),
      );

      const removed = await request(server).delete(`${base}/${clientId}`).auth(staff, { type: 'bearer' });
      expect(removed.status).toBe(204);

      const audit = await db.serviceDb
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, spaceId), eq(auditEvents.targetId, clientId)));
      expect(audit.map((a) => a.action).sort()).toEqual(['member.added', 'member.removed', 'member.role_changed']);
    });

    it('will not remove or demote the last admin', async () => {
      const staff = await agencyStaff();
      const base = `/v1/management/spaces/${spaceId}/members/${agencyId}`;

      const demote = await request(app.getHttpServer())
        .patch(base)
        .auth(staff, { type: 'bearer' })
        .send({ role: 'editor' });
      const remove = await request(app.getHttpServer()).delete(base).auth(staff, { type: 'bearer' });

      expect(demote.status).toBe(409);
      expect(demote.body.code).toBe('last_admin');
      expect(remove.status).toBe(409);
    });

    it('a member of another space cannot reach this one even with a forged role claim, because RLS disagrees', async () => {
      // The guard trusts the signed claim; RLS reads the same claim, so both refuse a non-member.
      const outsider = await clientEditor();
      const res = await request(app.getHttpServer())
        .get(`/v1/management/spaces/${spaceId}/members`)
        .auth(outsider, { type: 'bearer' });

      expect(res.status).toBe(403);
      const rows = await db.userDb(
        { sub: clientId, role: 'authenticated', spaces: [{ id: demoSpaceId, role: 'editor' }] },
        (tx) =>
          tx
            .select()
            .from(members)
            .where(inArray(members.spaceId, [spaceId])),
      );
      expect(rows).toHaveLength(0);
    });

    it.skipIf(!process.env['SUPABASE_SERVICE_ROLE_KEY'])(
      'inviting an existing account adds them directly',
      async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/management/spaces/${spaceId}/invites`)
          .auth(await agencyStaff(), { type: 'bearer' })
          .send({ email: 'Client@Novan.test', role: 'author' });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ userId: clientId, role: 'author' });
      },
    );
  });
});
