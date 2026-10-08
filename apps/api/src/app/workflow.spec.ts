import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { Mailer, MemoryMailer } from '@novan/api-common';
import { DbService, entryVersions, members, roles, spaces } from '@novan/api-db';
import type { Entry, EntrySummary, EntryWorkflow, PendingReview } from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// Needs the local Supabase database (`npm run db:start && npm run db:reset`). Every allowed and forbidden
// transition per role is in libs/api/content/src/lib/workflow.spec.ts; these check the API and the database
// apply them, and that the emails go out.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
// Seeded users (supabase/seed.sql): the client asks, the Novan admin reviews.
const clientId = '00000000-0000-4000-8000-000000000002';
const novanAdminId = '00000000-0000-4000-8000-000000000003';
const developerId = '00000000-0000-4000-8000-000000000004';
const organisationId = '00000000-0000-4000-8000-000000000100';

function token(sub: string, spaceId: string, role: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: 'aal1', spaces: [{ id: spaceId, role }], agency_staff: false })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

const field = (apiId: string, type: string, extra: object = {}) => ({ id: apiId, apiId, label: apiId, type, ...extra });

describe.skipIf(!hasDatabase)('workflow API', () => {
  let app: INestApplication;
  let db: DbService;
  const mailer = new MemoryMailer();
  let spaceId: string;
  let author: string;
  let editor: string;
  let admin: string;
  let viewer: string;
  let about: Entry;
  let contact: Entry;

  const base = () => `/v1/management/spaces/${spaceId}/environments/main`;
  const get = (path: string, as: string) => request(app.getHttpServer()).get(`${base()}${path}`).auth(as, { type: 'bearer' });
  const post = (path: string, as: string, body: object = {}) =>
    request(app.getHttpServer()).post(`${base()}${path}`).auth(as, { type: 'bearer' }).send(body);
  const patch = (path: string, as: string, body: object) =>
    request(app.getHttpServer()).patch(`${base()}${path}`).auth(as, { type: 'bearer' }).send(body);
  const workflow = async (id: string, as: string): Promise<EntryWorkflow> => (await get(`/entries/${id}/workflow`, as)).body;
  const approval = (on: boolean) =>
    request(app.getHttpServer()).patch(`/v1/management/spaces/${spaceId}`).auth(admin, { type: 'bearer' }).send({ requireApproval: on });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(Mailer)
      .useValue(mailer)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);

    const [space] = await db.serviceDb
      .insert(spaces)
      .values({ organisationId, name: 'Workflow test', slug: `workflow-${Date.now()}` })
      .returning({ id: spaces.id });
    spaceId = space.id;
    // Real memberships too: emails go to the space's admins, and members see each other's names.
    const roleId = async (key: string) =>
      (await db.serviceDb.select({ id: roles.id }).from(roles).where(and(eq(roles.spaceId, spaceId), eq(roles.key, key))))[0].id;
    await db.serviceDb.insert(members).values([
      { spaceId, userId: novanAdminId, roleId: await roleId('admin') },
      { spaceId, userId: clientId, roleId: await roleId('author') },
      { spaceId, userId: developerId, roleId: await roleId('editor') },
    ]);

    author = await token(clientId, spaceId, 'author');
    editor = await token(developerId, spaceId, 'editor');
    admin = await token(novanAdminId, spaceId, 'admin');
    viewer = await token(developerId, spaceId, 'viewer');

    const created = await post('/content-types', admin, {
      apiId: 'page',
      name: 'Page',
      kind: 'page',
      fields: [field('title', 'text', { required: true }), field('slug', 'text', { required: true }), field('cta', 'link')],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    about = (await post('/entries', author, { contentType: 'page', data: { title: 'About', slug: 'about' } })).body;
    contact = (
      await post('/entries', author, {
        contentType: 'page',
        data: { title: 'Contact', slug: 'contact', cta: { type: 'internal', entryId: about.id, text: 'About us' } },
      })
    ).body;
  });

  afterAll(async () => {
    if (spaceId) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceId));
    await app.close();
  });

  beforeEach(() => mailer.sent.splice(0));

  it('without approval, editors publish and nobody submits', async () => {
    const refused = await post(`/entries/${about.id}/submit`, author);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('approval_not_required');
    expect((await workflow(about.id, editor)).actions).toEqual(['edit', 'publish', 'archive']);
    expect((await workflow(about.id, author)).actions).toEqual(['edit']);
    expect((await workflow(about.id, viewer)).actions).toEqual([]);
  });

  it('with approval on, only space admins publish; authors send pages for review and admins are emailed', async () => {
    expect((await approval(true)).body.requireApproval).toBe(true);
    const refused = await post(`/entries/${about.id}/publish`, editor);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('approval_required');

    const submitted = await post(`/entries/${about.id}/submit`, author, { message: 'Ready for a look' });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.status).toBe('in_review');
    expect(mailer.sent).toEqual([
      expect.objectContaining({ to: ['novanwebservices@gmail.com'], subject: 'Review requested: About', text: expect.stringContaining('Ready for a look') }),
    ]);

    const inbox: PendingReview[] = (await get('/reviews', admin)).body;
    expect(inbox.map((review) => [review.entry.title, review.requestedByName, review.message])).toEqual([['About', 'Client User', 'Ready for a look']]);
    expect((await workflow(about.id, admin)).actions).toEqual(['edit', 'approve', 'requestChanges', 'archive']);
    expect((await workflow(about.id, editor)).actions).toEqual(['edit', 'archive']);

    const notYours = await post(`/entries/${about.id}/approve`, editor);
    expect(notYours.status).toBe(403);
    expect(notYours.body.code).toBe('approval_required');
  });

  it('an admin asks for changes with a comment; the author is emailed and the page is a draft again', async () => {
    expect((await post(`/entries/${about.id}/request-changes`, admin, { comment: ' ' })).status).toBe(400);
    const sent = await post(`/entries/${about.id}/request-changes`, admin, { comment: 'Add our opening hours.' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.status).toBe('draft');
    expect(mailer.sent).toEqual([
      expect.objectContaining({ to: ['client@novan.test'], subject: 'Changes requested: About', text: expect.stringContaining('Add our opening hours.') }),
    ]);
    const flow = await workflow(about.id, author);
    expect(flow.review).toMatchObject({ decision: 'changes_requested', comment: 'Add our opening hours.', decidedByName: 'Novan Admin' });
    expect((await get('/reviews', admin)).body).toEqual([]);
  });

  it('changing a page in review takes it out of review', async () => {
    await post(`/entries/${about.id}/submit`, author);
    const edited = await patch(`/entries/${about.id}`, author, { data: { title: 'About us', slug: 'about' } });
    expect(edited.body.status).toBe('draft');
    expect((await workflow(about.id, author)).review).toMatchObject({ decision: 'withdrawn' });
  });

  it('an admin approves with a message: the page goes live, the message is on the version, the author is emailed', async () => {
    await post(`/entries/${about.id}/submit`, author);
    mailer.sent.splice(0);
    const approved = await post(`/entries/${about.id}/approve`, admin, { message: 'Approved for launch' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ status: 'published', publishedPath: '/about' });
    const [version] = await db.serviceDb.select({ message: entryVersions.message }).from(entryVersions).where(eq(entryVersions.id, approved.body.publishedVersionId));
    expect(version.message).toBe('Approved for launch');
    expect(mailer.sent).toEqual([expect.objectContaining({ to: ['client@novan.test'], subject: 'Published: About us' })]);
    expect((await workflow(about.id, admin)).state).toBe('published');
  });

  it('names the pages that link to a page before it is unpublished', async () => {
    const linking: EntrySummary[] = (await get(`/entries/${about.id}/references`, editor)).body;
    expect(linking.map((entry) => entry.id)).toEqual([contact.id]);
    expect((await get(`/entries/${contact.id}/references`, editor)).body).toEqual([]);
  });

  it('archives a page (taking it off the site) and restores it as a draft', async () => {
    const archived = await post(`/entries/${about.id}/archive`, editor);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(archived.body).toMatchObject({ status: 'archived', publishedPath: null });
    const edit = await patch(`/entries/${about.id}`, author, { data: { title: 'Nope', slug: 'about' } });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('workflow_state');
    expect((await post(`/entries/${about.id}/unarchive`, author)).status).toBe(403);
    expect((await post(`/entries/${about.id}/unarchive`, editor)).body.status).toBe('draft');
  });

  it('with approval off again, editors publish directly', async () => {
    await approval(false);
    const published = await post(`/entries/${contact.id}/publish`, editor);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(mailer.sent).toEqual([]);
  });
});
