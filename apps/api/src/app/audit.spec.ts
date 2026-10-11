import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { auditEvents, DbService, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import type { AuditActor, AuditContentDiff, AuditEvent, AuditEventsPage, Entry } from '@novan/shared-schemas';
import { eq, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// The audit log screen's API (docs/build/18-search-forms-audit.md). Needs the local Supabase database; who may read
// audit events is in supabase/tests/tenancy.test.sql.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
// Seeded users (supabase/seed.sql): Novan Admin has a display name.
const novanAdminId = '00000000-0000-4000-8000-000000000003';
const clientId = '00000000-0000-4000-8000-000000000002';
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

describe.skipIf(!hasDatabase)('audit log', () => {
  const run = Date.now();
  let app: INestApplication;
  let db: DbService;
  let space: string;
  let admin: string;
  let editor: string;
  let clientEditor: string;
  let page: Entry;

  const server = () => app.getHttpServer();
  const as = (token: string) => ({
    get: (path: string) => request(server()).get(`/v1/management/spaces/${space}${path}`).auth(token, { type: 'bearer' }),
    post: (path: string, body: object = {}) => request(server()).post(`/v1/management/spaces/${space}${path}`).auth(token, { type: 'bearer' }).send(body),
    patch: (path: string, body: object) => request(server()).patch(`/v1/management/spaces/${space}${path}`).auth(token, { type: 'bearer' }).send(body),
  });
  const events = async (query = ''): Promise<AuditEvent[]> => {
    const res = await as(admin).get(`/audit-events${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body as AuditEventsPage).items;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue({ enabled: false })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);
    [{ id: space }] = await db.serviceDb.insert(spaces).values({ organisationId, name: 'Audit', slug: `audit-${run}` }).returning({ id: spaces.id });
    admin = await jwt(novanAdminId, space, 'admin');
    editor = await jwt(novanAdminId, space, 'editor');
    clientEditor = await jwt(clientId, space, 'editor');

    expect(
      (
        await as(admin).post('/environments/main/content-types', {
          apiId: 'page',
          name: 'Page',
          kind: 'page',
          fields: [field('title', 'text', { required: true }), field('slug', 'text', { required: true }), field('intro', 'text')],
        })
      ).status,
    ).toBe(201);
    page = (await as(editor).post('/environments/main/entries', { contentType: 'page', data: { title: 'Welcome', slug: 'welcome' } })).body;
    expect((await as(editor).post(`/environments/main/entries/${page.id}/publish`)).status).toBe(200);
    expect((await as(clientEditor).patch(`/environments/main/entries/${page.id}`, { data: { title: 'Welcome home', slug: 'welcome', intro: 'Hello' } })).status).toBe(200);
    expect((await as(clientEditor).post(`/environments/main/entries/${page.id}/publish`)).status).toBe(200);
    // One event from last week, for the date filters.
    await db.serviceDb.insert(auditEvents).values({ spaceId: space, actorId: novanAdminId, action: 'redirect.created', targetType: 'redirect', createdAt: sql`now() - interval '7 days'` });
  });

  afterAll(async () => {
    if (space) await db.serviceDb.delete(spaces).where(eq(spaces.id, space));
    await app?.close();
  });

  it('shows space admins who did what, newest first', async () => {
    const all = await events();
    expect(all.map((event) => event.action).slice(0, 4)).toEqual(['entry.published', 'entry.published', 'entry.created', 'content_type.created']);
    expect(all[all.length - 1].action).toBe('redirect.created');
    expect(all[2]).toMatchObject({ actorId: novanAdminId, actorName: 'Novan Admin', targetType: 'entry', targetId: page.id, hasContentDiff: false });
    expect(all[0].hasContentDiff).toBe(true);
  });

  it('is for admins only', async () => {
    expect((await as(editor).get('/audit-events')).status).toBe(403);
    expect((await as(editor).get('/audit-events/actors')).status).toBe(403);
  });

  it('filters by person, action, a kind of thing and UK day', async () => {
    expect((await events(`?actor=${clientId}`)).map((event) => event.action)).toEqual(['entry.published']);
    expect(await events('?action=entry.created')).toHaveLength(1);
    expect((await events('?action=entry')).map((event) => event.action)).toEqual(['entry.published', 'entry.published', 'entry.created']);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
    expect((await events(`?from=${today}`)).map((event) => event.action)).not.toContain('redirect.created');
    expect((await events(`?to=${today}&from=2000-01-01`)).length).toBe((await events()).length);
    const lastWeek = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() - 7 * 86_400_000));
    expect((await events(`?from=${lastWeek}&to=${lastWeek}`)).map((event) => event.action)).toEqual(['redirect.created']);
    expect((await as(admin).get('/audit-events?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await as(admin).get('/audit-events?action=DROP%20TABLE')).status).toBe(400);
  });

  it('pages through the log', async () => {
    const total = (await events()).length;
    const first: AuditEventsPage = (await as(admin).get('/audit-events?limit=2')).body;
    const rest: AuditEventsPage = (await as(admin).get(`/audit-events?limit=100&cursor=${first.nextCursor}`)).body;
    expect(first.items).toHaveLength(2);
    expect(first.items.length + rest.items.length).toBe(total);
    expect(new Set([...first.items, ...rest.items].map((event) => event.id)).size).toBe(total);
    expect((await as(admin).get('/audit-events?cursor=bm9wZQ')).body.code).toBe('invalid_cursor');
  });

  it('lists the people in the log', async () => {
    const actors: AuditActor[] = (await as(admin).get('/audit-events/actors')).body;
    expect(actors.map((actor) => actor.id).sort()).toEqual([clientId, novanAdminId].sort());
  });

  it('shows what a publish changed in the page', async () => {
    const [second, first] = await events('?action=entry.published');
    const diff: AuditContentDiff = (await as(admin).get(`/audit-events/${second.id}/content-diff`)).body;
    expect(diff).toMatchObject({ entryId: page.id, fromVersionId: first.diff?.['versionId'], toVersionId: second.diff?.['versionId'] });
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        { kind: 'changed', path: ['title'], before: 'Welcome', after: 'Welcome home' },
        { kind: 'added', path: ['intro'], after: 'Hello' },
      ]),
    );
    const firstDiff: AuditContentDiff = (await as(admin).get(`/audit-events/${first.id}/content-diff`)).body;
    expect(firstDiff.fromVersionId).toBeNull();
    expect(firstDiff.changes).toEqual(expect.arrayContaining([{ kind: 'added', path: ['title'], after: 'Welcome' }]));

    const [created] = await events('?action=entry.created');
    expect((await as(admin).get(`/audit-events/${created.id}/content-diff`)).body.code).toBe('no_content_diff');
  });

  it('exports the filtered log as CSV, and audits the export', async () => {
    const res = await as(admin).get('/audit-events/export?action=entry');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('"When (UTC)","Person","What happened","Action","Item type","Item","Details"');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('"Novan Admin","Created a page","entry.created","entry"');
    expect((await events('?action=audit_log.exported'))[0].diff).toMatchObject({ action: 'entry', events: 3 });
  });
});
