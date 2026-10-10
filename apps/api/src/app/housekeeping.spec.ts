import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { ContentHousekeeping } from '@novan/api-content';
import { assets, auditEvents, DbService, entries, entryVersions, releaseItems, releases, reviewRequests, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import { JobHandlers } from '@novan/api-jobs';
import { MediaHousekeeping, MediaStorage } from '@novan/api-media';
import type { Entry } from '@novan/shared-schemas';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// Housekeeping (docs/build/17-scheduling-releases-webhooks.md, 0018_housekeeping.sql). Needs the local Supabase
// database. The jobs run over every space, so each test makes its rows old enough by hand and checks only its own.
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
const storage = { removeOrThrow: vi.fn<(paths: string[]) => Promise<void>>().mockResolvedValue(undefined) };

describe.skipIf(!hasDatabase)('housekeeping', () => {
  const run = Date.now();
  let app: INestApplication;
  let db: DbService;
  let space: string;
  let editor: string;

  const server = () => app.getHttpServer();
  const page = async (slug: string): Promise<Entry> => {
    const res = await request(server())
      .post(`/v1/management/spaces/${space}/environments/main/entries`)
      .auth(editor, { type: 'bearer' })
      .send({ contentType: 'page', data: { title: slug, slug } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const bin = (id: string) => request(server()).delete(`/v1/management/spaces/${space}/environments/main/entries/${id}`).auth(editor, { type: 'bearer' });
  const daysAgo = (days: number) => sql`now() - make_interval(days => ${days})`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue({ enabled: false })
      .overrideProvider(MediaStorage)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);
    const [created] = await db.serviceDb.insert(spaces).values({ organisationId, name: 'Housekeeping', slug: `housekeeping-${run}` }).returning({ id: spaces.id });
    space = created.id;
    editor = await jwt(novanAdminId, space, 'editor');
    const type = await request(server())
      .post(`/v1/management/spaces/${space}/environments/main/content-types`)
      .auth(await jwt(novanAdminId, space, 'developer'), { type: 'bearer' })
      .send({ apiId: 'page', name: 'Page', kind: 'page', fields: [field('title', 'text', { required: true }), field('slug', 'text', { required: true })] });
    expect(type.status, JSON.stringify(type.body)).toBe(201);
  });

  afterAll(async () => {
    if (space) await db.serviceDb.delete(spaces).where(eq(spaces.id, space));
    await app?.close();
  });

  it('the nightly jobs have handlers on the housekeeping queue', () => {
    const handlers = app.get(JobHandlers);
    for (const type of ['purge-bin', 'purge-assets', 'prune-autosaves']) expect(handlers.find('housekeeping', type), type).toBeDefined();
  });

  it('deletes pages in the bin for more than 30 days, with their versions, and audits it; newer ones stay', async () => {
    const old = await page(`old-${run}`);
    const recent = await page(`recent-${run}`);
    const kept = await page(`kept-${run}`);
    expect((await bin(old.id)).status).toBe(204);
    expect((await bin(recent.id)).status).toBe(204);
    await db.serviceDb.update(entries).set({ deletedAt: daysAgo(31) }).where(eq(entries.id, old.id));
    await db.serviceDb.update(entries).set({ deletedAt: daysAgo(29) }).where(eq(entries.id, recent.id));

    expect(await app.get(ContentHousekeeping).purgeBin()).toBeGreaterThanOrEqual(1);
    const left = await db.serviceDb.select({ id: entries.id }).from(entries).where(eq(entries.spaceId, space));
    expect(left.map((e) => e.id).sort()).toEqual([recent.id, kept.id].sort());
    expect(await db.serviceDb.select().from(entryVersions).where(eq(entryVersions.entryId, old.id))).toHaveLength(0);
    const [audit] = await db.serviceDb.select().from(auditEvents).where(and(eq(auditEvents.spaceId, space), eq(auditEvents.action, 'entry.purged')));
    expect(audit).toMatchObject({ targetType: 'entry', targetId: old.id, actorId: null });
  });

  it('prunes autosaves older than 90 days, but never current, published, reviewed, released or named versions', async () => {
    const p = await page(`versions-${run}`);
    const [row] = await db.serviceDb.select().from(entries).where(eq(entries.id, p.id));
    const version = (autosave: boolean, days: number, message: string | null = null) =>
      db.serviceDb
        .insert(entryVersions)
        .values({ entryId: p.id, spaceId: space, data: { title: 'x', slug: `versions-${run}` }, autosave, message, createdAt: sql`now() - make_interval(days => ${days})` })
        .returning({ id: entryVersions.id })
        .then(([v]) => v.id);
    const stale = await version(true, 100);
    const recentAutosave = await version(true, 80);
    const named = await version(false, 200, 'Before the relaunch');
    const unnamedSave = await version(false, 200);
    const reviewed = await version(true, 100);
    const released = await version(true, 100);
    const current = await version(true, 100);
    await db.serviceDb.update(entries).set({ currentVersionId: current }).where(eq(entries.id, p.id));
    await db.serviceDb.insert(reviewRequests).values({ spaceId: space, entryId: p.id, versionId: reviewed, decision: 'withdrawn', decidedAt: sql`now()` });
    const [release] = await db.serviceDb.insert(releases).values({ spaceId: space, environmentId: row.environmentId, name: 'R' }).returning({ id: releases.id });
    await db.serviceDb.insert(releaseItems).values({ releaseId: release.id, spaceId: space, environmentId: row.environmentId, entryId: p.id, versionId: released });

    expect(await app.get(ContentHousekeeping).pruneAutosaves()).toBeGreaterThanOrEqual(1);
    const left = await db.serviceDb.select({ id: entryVersions.id }).from(entryVersions).where(eq(entryVersions.entryId, p.id));
    const ids = left.map((v) => v.id);
    expect(ids).not.toContain(stale);
    expect(ids).toEqual(expect.arrayContaining([recentAutosave, named, unnamedSave, reviewed, released, current, row.currentVersionId as string]));
  });

  it('nobody else can delete versions, even old autosaves', async () => {
    const p = await page(`guarded-${run}`);
    const [v] = await db.serviceDb
      .insert(entryVersions)
      .values({ entryId: p.id, spaceId: space, data: {}, autosave: true, createdAt: sql`now() - interval '200 days'` })
      .returning({ id: entryVersions.id });
    await expect(db.serviceDb.delete(entryVersions).where(eq(entryVersions.id, v.id))).rejects.toThrow();
  });

  it('deletes files in the bin for more than 30 days from Storage, then from the library; keeps them if Storage refuses', async () => {
    const file = async (name: string, days: number | null) => {
      const id = randomUUID();
      await db.serviceDb
        .insert(assets)
        .values({ id, spaceId: space, path: `spaces/${space}/${id}/${name}`, filename: name, mime: 'image/png', sizeBytes: 10, deletedAt: days === null ? null : daysAgo(days) });
      return id;
    };
    const old = await file(`old-${run}.png`, 31);
    const recent = await file(`recent-${run}.png`, 10);
    const live = await file(`live-${run}.png`, null);

    storage.removeOrThrow.mockRejectedValueOnce(new Error('Storage down'));
    await expect(app.get(MediaHousekeeping).purgeAssets()).rejects.toThrow('Storage down');
    expect(await db.serviceDb.select().from(assets).where(eq(assets.id, old))).toHaveLength(1);

    storage.removeOrThrow.mockClear();
    expect(await app.get(MediaHousekeeping).purgeAssets()).toBeGreaterThanOrEqual(1);
    expect(storage.removeOrThrow.mock.calls.flat(2)).toContain(`spaces/${space}/${old}/old-${run}.png`);
    const left = await db.serviceDb.select({ id: assets.id }).from(assets).where(inArray(assets.id, [old, recent, live]));
    expect(left.map((a) => a.id).sort()).toEqual([recent, live].sort());
    const [audit] = await db.serviceDb.select().from(auditEvents).where(and(eq(auditEvents.spaceId, space), eq(auditEvents.action, 'asset.purged')));
    expect(audit.targetId).toBe(old);
  });
});
