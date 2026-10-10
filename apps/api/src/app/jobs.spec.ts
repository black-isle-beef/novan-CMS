import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { Mailer, MemoryMailer } from '@novan/api-common';
import { auditEvents, DbService, jobDeadLetters, members, publishedContent, roles, scheduledActions, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import { enqueue, type Job, JOBS_CONFIG, JobHandlers, type JobsConfig, JobWorker, PermanentJobError } from '@novan/api-jobs';
import type { Entry, ScheduledAction } from '@novan/shared-schemas';
import { and, eq, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// Background jobs and scheduled publishing (docs/build/17-scheduling-releases-webhooks.md). Needs the local Supabase
// database (`npm run db:start && npm run db:reset`); RLS for scheduled_actions and the queues is in
// supabase/tests/jobs.test.sql. Each test reads only its own jobs, so no other worker may run against the database.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
const clientId = '00000000-0000-4000-8000-000000000002';
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Short timeouts, so retries and a dead worker's jobs come back within a test.
const config: JobsConfig = { visibilitySeconds: 1, maxAttempts: 3, retryBaseSeconds: 1, retryMaxSeconds: 1, pollMs: 50, batchSize: 10, alertEmails: ['ops@novan.test'] };

const cloudflare = {
  enabled: true,
  purgeTags: vi.fn<(tags: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
  purgeUrls: vi.fn<(urls: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
};

describe.skipIf(!hasDatabase)('background jobs', () => {
  const run = Date.now();
  const mailer = new MemoryMailer();
  let app: INestApplication;
  let db: DbService;
  let worker: JobWorker;
  let handlers: JobHandlers;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue(cloudflare)
      .overrideProvider(JOBS_CONFIG)
      .useValue(config)
      .overrideProvider(Mailer)
      .useValue(mailer)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);
    worker = app.get(JobWorker);
    handlers = app.get(JobHandlers);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('the queues', () => {
    let n = 0;
    /** A job type of this test alone, on the housekeeping queue. */
    const type = () => `test-${run}-${++n}`;
    const queued = async (jobType: string) =>
      (await db.serviceDb.execute<{ n: number }>(sql`select count(*)::int as n from pgmq.q_housekeeping where message ->> 'type' = ${jobType}`))[0].n;

    it('a job exists exactly when the transaction that sent it commits', async () => {
      const kept = type();
      const lost = type();
      await db.transaction((tx) => enqueue(tx, 'housekeeping', { type: kept }));
      await expect(
        db.transaction(async (tx) => {
          await enqueue(tx, 'housekeeping', { type: lost });
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      expect(await queued(kept)).toBe(1);
      expect(await queued(lost)).toBe(0);
    });

    it('sends from a request transaction, which stays the caller\'s afterwards', async () => {
      const jobType = type();
      const role = await db.userDb({ sub: clientId, role: 'authenticated' }, async (tx) => {
        await enqueue(tx, 'housekeeping', { type: jobType });
        return (await tx.execute<{ role: string }>(sql`select current_user::text as role`))[0].role;
      });
      expect(role).toBe('authenticated');
      expect(await queued(jobType)).toBe(1);
    });

    it('runs a job with its handler and deletes it', async () => {
      const jobType = type();
      const seen: Job[] = [];
      handlers.register('housekeeping', jobType, async (job) => void seen.push(job));
      await db.transaction((tx) => enqueue(tx, 'housekeeping', { type: jobType, value: 42 }));
      expect(await worker.runOnce('housekeeping', { type: jobType })).toBe(1);
      expect(seen).toEqual([{ type: jobType, value: 42 }]);
      expect(await queued(jobType)).toBe(0);
    });

    it('loses nothing when the worker dies mid-job: the job runs again once its timeout ends', async () => {
      const jobType = type();
      const attempts: number[] = [];
      handlers.register('housekeeping', jobType, async (_, context) => void attempts.push(context.attempt));
      await db.transaction((tx) => enqueue(tx, 'housekeeping', { type: jobType }));
      // A worker reads the job, then is killed before finishing it.
      await db.serviceDb.execute(sql`select * from pgmq.read('housekeeping', 1, 1, ${JSON.stringify({ type: jobType })}::jsonb)`);
      expect(await worker.runOnce('housekeeping', { type: jobType })).toBe(0);

      await sleep(1100);
      expect(await worker.runOnce('housekeeping', { type: jobType })).toBe(1);
      expect(attempts).toEqual([2]);
      expect(await queued(jobType)).toBe(0);
    });

    it('retries a failing job with back-off, then dead-letters it and alerts the agency', async () => {
      const jobType = type();
      let calls = 0;
      handlers.register('housekeeping', jobType, async () => {
        calls++;
        throw new Error('receiver down');
      });
      await db.transaction((tx) => enqueue(tx, 'housekeeping', { type: jobType, spaceId: organisationId }));

      expect(await worker.runOnce('housekeeping', { type: jobType })).toBe(1);
      // Hidden until the back-off ends.
      expect(await worker.runOnce('housekeeping', { type: jobType })).toBe(0);
      for (let attempt = 2; attempt <= config.maxAttempts; attempt++) {
        await sleep(1100);
        expect(await worker.runOnce('housekeeping', { type: jobType })).toBe(1);
      }
      expect(calls).toBe(config.maxAttempts);
      expect(await queued(jobType)).toBe(0);
      const [dead] = await db.serviceDb.select().from(jobDeadLetters).where(sql`${jobDeadLetters.message} ->> 'type' = ${jobType}`);
      expect(dead).toMatchObject({ queue: 'housekeeping', attempts: config.maxAttempts, error: 'receiver down' });
      const alert = mailer.sent[mailer.sent.length - 1];
      expect(alert).toMatchObject({ to: ['ops@novan.test'], subject: 'Novan CMS: a housekeeping job failed' });
      expect(alert.text).toContain(jobType);
    });

    it('dead-letters a job no retry can fix, or nobody handles, at once', async () => {
      const broken = type();
      const unknown = type();
      handlers.register('housekeeping', broken, async () => {
        throw new PermanentJobError('malformed');
      });
      await db.transaction(async (tx) => {
        await enqueue(tx, 'housekeeping', { type: broken });
        await enqueue(tx, 'housekeeping', { type: unknown });
      });
      await worker.runOnce('housekeeping', { type: broken });
      await worker.runOnce('housekeeping', { type: unknown });
      const dead = await db.serviceDb
        .select({ type: sql<string>`${jobDeadLetters.message} ->> 'type'`, attempts: jobDeadLetters.attempts, error: jobDeadLetters.error })
        .from(jobDeadLetters)
        .where(sql`${jobDeadLetters.message} ->> 'type' in (${broken}, ${unknown})`)
        .orderBy(jobDeadLetters.failedAt);
      expect(dead).toEqual([
        { type: broken, attempts: 1, error: 'malformed' },
        { type: unknown, attempts: 1, error: `No handler for "${unknown}" jobs on the housekeeping queue` },
      ]);
    });

    it('a running worker picks jobs up by itself, and stops cleanly', async () => {
      const jobType = type();
      const seen: string[] = [];
      handlers.register('housekeeping', jobType, async (job) => void seen.push(job.type));
      worker.start(['housekeeping']);
      try {
        await db.transaction((tx) => enqueue(tx, 'housekeeping', { type: jobType }));
        await vi.waitFor(() => expect(seen).toEqual([jobType]), { timeout: 3000 });
      } finally {
        await worker.stop();
      }
    });
  });

  describe('scheduled publishing', () => {
    let spaceA: string;
    let spaceB: string;
    let editorA: string;
    let authorA: string;
    let editorB: string;
    let adminB: string;
    let page: Entry;

    const server = () => app.getHttpServer();
    const manage = (spaceId: string, as: string) => ({
      get: (path: string) => request(server()).get(`/v1/management/spaces/${spaceId}/environments/main${path}`).auth(as, { type: 'bearer' }),
      post: (path: string, body: object = {}) =>
        request(server()).post(`/v1/management/spaces/${spaceId}/environments/main${path}`).auth(as, { type: 'bearer' }).send(body),
    });
    const inAMinute = () => new Date(Date.now() + 60_000).toISOString();
    /** Makes the space's waiting actions due, runs the cron job's function, and runs the space's publish jobs. */
    const runDue = async (spaceId: string): Promise<void> => {
      await db.serviceDb
        .update(scheduledActions)
        .set({ runAt: sql`now() - interval '1 second'` })
        .where(and(eq(scheduledActions.spaceId, spaceId), eq(scheduledActions.status, 'scheduled')));
      await db.serviceDb.execute(sql`select public.enqueue_due_scheduled_actions()`);
      while (await worker.runOnce('publish', { spaceId })) {
        // until none are left
      }
    };
    const actionOf = async (id: string) => (await db.serviceDb.select().from(scheduledActions).where(eq(scheduledActions.id, id)))[0];

    beforeAll(async () => {
      const [a, b] = await db.serviceDb
        .insert(spaces)
        .values([
          { organisationId, name: 'Schedule A', slug: `schedule-a-${run}` },
          { organisationId, name: 'Schedule B', slug: `schedule-b-${run}`, requireApproval: true },
        ])
        .returning({ id: spaces.id });
      spaceA = a.id;
      spaceB = b.id;
      // The worker acts as whoever scheduled, with their memberships in the database.
      const role = async (spaceId: string, key: string) =>
        (await db.serviceDb.select({ id: roles.id }).from(roles).where(and(eq(roles.spaceId, spaceId), eq(roles.key, key))))[0].id;
      await db.serviceDb.insert(members).values([
        { spaceId: spaceA, userId: novanAdminId, roleId: await role(spaceA, 'editor') },
        { spaceId: spaceA, userId: clientId, roleId: await role(spaceA, 'author') },
        { spaceId: spaceB, userId: novanAdminId, roleId: await role(spaceB, 'editor') },
        { spaceId: spaceB, userId: clientId, roleId: await role(spaceB, 'admin') },
      ]);
      editorA = await jwt(novanAdminId, spaceA, 'editor');
      authorA = await jwt(clientId, spaceA, 'author');
      editorB = await jwt(novanAdminId, spaceB, 'editor');
      adminB = await jwt(clientId, spaceB, 'admin');

      for (const [spaceId, as] of [
        [spaceA, await jwt(novanAdminId, spaceA, 'developer')],
        [spaceB, await jwt(novanAdminId, spaceB, 'developer')],
      ]) {
        const created = await request(server())
          .post(`/v1/management/spaces/${spaceId}/environments/main/content-types`)
          .auth(as, { type: 'bearer' })
          .send({ apiId: 'page', name: 'Page', kind: 'page', fields: [field('title', 'text', { required: true }), field('slug', 'text', { required: true })] });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
      }
      const created = await manage(spaceA, editorA).post('/entries', { contentType: 'page', data: { title: 'Launch', slug: `launch-${run}` } });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      page = created.body;
    });

    afterAll(async () => {
      if (spaceA) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceA));
      if (spaceB) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceB));
    });

    it('an editor schedules a publish; it waits, audited, and is listed with the page', async () => {
      const runAt = inAMinute();
      const res = await manage(spaceA, editorA).post(`/entries/${page.id}/schedule`, { action: 'publish', runAt });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const action: ScheduledAction = res.body;
      expect(action).toMatchObject({ entryId: page.id, action: 'publish', status: 'scheduled', createdBy: novanAdminId, error: null, finishedAt: null });
      expect(Date.parse(action.runAt)).toBe(Date.parse(runAt));

      const listed = await manage(spaceA, authorA).get(`/entries/${page.id}/schedule`);
      expect(listed.body.map((a: ScheduledAction) => a.id)).toEqual([action.id]);
      const [audit] = await db.serviceDb
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, spaceA), eq(auditEvents.action, 'entry.scheduled')));
      expect(audit.diff).toMatchObject({ action: 'publish', scheduledActionId: action.id });
    });

    it('refuses a time in the past, a second publish, and people who may not publish', async () => {
      const editor = manage(spaceA, editorA);
      const past = await editor.post(`/entries/${page.id}/schedule`, { action: 'publish', runAt: '2020-01-01T09:00:00Z' });
      expect([past.status, past.body.code]).toEqual([400, 'run_at_past']);
      expect((await editor.post(`/entries/${page.id}/schedule`, { action: 'publish', runAt: inAMinute() })).body.code).toBe('already_scheduled');
      expect((await editor.post(`/entries/${page.id}/schedule`, { action: 'publish', runAt: 'tomorrow' })).status).toBe(400);
      expect((await manage(spaceA, authorA).post(`/entries/${page.id}/schedule`, { action: 'publish', runAt: inAMinute() })).status).toBe(403);
      // Another space's members do not even find the page.
      expect((await manage(spaceA, editorB).get(`/entries/${page.id}/schedule`)).status).toBe(403);
    });

    it('when the time comes, the worker publishes the page as whoever scheduled it, and purges the CDN', async () => {
      await runDue(spaceA);
      const [action] = await db.serviceDb.select().from(scheduledActions).where(eq(scheduledActions.entryId, page.id));
      expect(action).toMatchObject({ status: 'done', error: null });
      expect(action.finishedAt).not.toBeNull();
      const [live] = await db.serviceDb.select().from(publishedContent).where(eq(publishedContent.entryId, page.id));
      expect(live.fullPath).toBe(`/launch-${run}`);
      const [audit] = await db.serviceDb
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.targetId, page.id), eq(auditEvents.action, 'entry.published')));
      expect(audit.actorId).toBe(novanAdminId);

      cloudflare.purgeTags.mockClear();
      while (await worker.runOnce('purge', { spaceId: spaceA })) {
        // until none are left
      }
      expect(cloudflare.purgeTags).toHaveBeenCalledWith(expect.arrayContaining([`entry:${page.id}`]));
    });

    it('a cancelled action never runs, and cannot be cancelled twice', async () => {
      const editor = manage(spaceA, editorA);
      const scheduled: ScheduledAction = (await editor.post(`/entries/${page.id}/schedule`, { action: 'unpublish', runAt: inAMinute() })).body;
      const cancelled = await editor.post(`/entries/${page.id}/schedule/${scheduled.id}/cancel`);
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect(cancelled.body).toMatchObject({ status: 'cancelled' });
      expect((await editor.post(`/entries/${page.id}/schedule/${scheduled.id}/cancel`)).body.code).toBe('not_waiting');
      await runDue(spaceA);
      expect((await actionOf(scheduled.id)).status).toBe('cancelled');
      expect(await db.serviceDb.select().from(publishedContent).where(eq(publishedContent.entryId, page.id))).toHaveLength(1);
    });

    it('unpublishes on time too', async () => {
      const scheduled: ScheduledAction = (await manage(spaceA, editorA).post(`/entries/${page.id}/schedule`, { action: 'unpublish', runAt: inAMinute() })).body;
      await runDue(spaceA);
      expect((await actionOf(scheduled.id)).status).toBe('done');
      expect(await db.serviceDb.select().from(publishedContent).where(eq(publishedContent.entryId, page.id))).toHaveLength(0);
    });

    it('fails with the reason when the page cannot be published then, or the person lost their role', async () => {
      const editor = manage(spaceA, editorA);
      const incomplete: Entry = (await editor.post('/entries', { contentType: 'page', data: { slug: `incomplete-${run}` } })).body;
      const invalid: ScheduledAction = (await editor.post(`/entries/${incomplete.id}/schedule`, { action: 'publish', runAt: inAMinute() })).body;
      const later: ScheduledAction = (await editor.post(`/entries/${page.id}/schedule`, { action: 'publish', runAt: inAMinute() })).body;
      // Before it runs, the editor becomes an author.
      const [author] = await db.serviceDb.select({ id: roles.id }).from(roles).where(and(eq(roles.spaceId, spaceA), eq(roles.key, 'author')));
      await db.serviceDb.update(members).set({ roleId: author.id }).where(and(eq(members.spaceId, spaceA), eq(members.userId, novanAdminId)));

      await runDue(spaceA);
      expect(await actionOf(invalid.id)).toMatchObject({ status: 'failed' });
      expect(await actionOf(later.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('role') });
      expect(await db.serviceDb.select().from(publishedContent).where(eq(publishedContent.entryId, page.id))).toHaveLength(0);
    });

    it('with approval on, only space admins schedule publishing; editors may schedule unpublishing', async () => {
      const created: Entry = (await manage(spaceB, adminB).post('/entries', { contentType: 'page', data: { title: 'B', slug: `b-${run}` } })).body;
      const refused = await manage(spaceB, editorB).post(`/entries/${created.id}/schedule`, { action: 'publish', runAt: inAMinute() });
      expect([refused.status, refused.body.code]).toEqual([403, 'approval_required']);
      expect((await manage(spaceB, editorB).post(`/entries/${created.id}/schedule`, { action: 'unpublish', runAt: inAMinute() })).status).toBe(201);
      const scheduled: ScheduledAction = (await manage(spaceB, adminB).post(`/entries/${created.id}/schedule`, { action: 'publish', runAt: inAMinute() })).body;
      expect(scheduled.status).toBe('scheduled');
    });

    it('moving a page to the bin cancels what was waiting for it', async () => {
      const admin = await jwt(clientId, spaceA, 'admin');
      const created: Entry = (await manage(spaceA, admin).post('/entries', { contentType: 'page', data: { title: 'Bin', slug: `bin-${run}` } })).body;
      const scheduled: ScheduledAction = (await manage(spaceA, admin).post(`/entries/${created.id}/schedule`, { action: 'publish', runAt: inAMinute() })).body;
      expect((await request(server()).delete(`/v1/management/spaces/${spaceA}/environments/main/entries/${created.id}`).auth(admin, { type: 'bearer' })).status).toBe(204);
      expect((await actionOf(scheduled.id)).status).toBe('cancelled');
    });
  });
});
