import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { Mailer, MemoryMailer } from '@novan/api-common';
import { auditEvents, DbService, formSubmissions, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import { FormsHousekeeping, TURNSTILE_CONFIG, type TurnstileConfig } from '@novan/api-forms';
import { JOBS_CONFIG, type JobsConfig, JobWorker } from '@novan/api-jobs';
import type { CreatedApiToken, Entry, FormSettings, FormSubmission, FormSubmissionsPage, FormSummary } from '@novan/shared-schemas';
import { and, eq, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// Forms (docs/build/18-search-forms-audit.md): submitting through the Delivery API, the inbox, emails and retention.
// Needs the local Supabase database; who reads and deletes submissions is in supabase/tests/forms.test.sql.
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
const jobs: JobsConfig = { visibilitySeconds: 5, maxAttempts: 3, retryBaseSeconds: 1, retryMaxSeconds: 1, pollMs: 50, batchSize: 10, alertEmails: [] };

/** The `form` block type as seeded (supabase/seed.sql). */
const formBlock = {
  apiId: 'form',
  name: 'Form',
  fields: [
    field('heading', 'text', { localised: true }),
    field('fields', 'group', {
      required: true,
      multiple: true,
      min: 1,
      fields: [
        field('label', 'text', { required: true, localised: true }),
        field('name', 'text', { required: true, pattern: '[a-z0-9]+(-[a-z0-9]+)*' }),
        field('type', 'select', {
          required: true,
          options: ['text', 'email', 'textarea', 'select', 'checkbox', 'consent'].map((value) => ({ value, label: value })),
        }),
        field('required', 'boolean', { default: false }),
        field('help', 'text', { localised: true }),
        field('options', 'text', { localised: true, multiline: true }),
      ],
    }),
    field('submitLabel', 'text', { required: true, localised: true }),
    field('successMessage', 'text', { required: true, localised: true }),
  ],
};

const contactForm = (uid: string, extra: object = {}) => ({
  _uid: uid,
  _block: 'form',
  heading: { 'en-GB': 'Get in touch' },
  fields: [
    { label: { 'en-GB': 'Your name' }, name: 'name', type: 'text', required: true },
    { label: { 'en-GB': 'Email' }, name: 'email', type: 'email', required: true },
    { label: { 'en-GB': 'Topic' }, name: 'topic', type: 'select', required: false, options: { 'en-GB': 'Sales\nSupport' } },
    { label: { 'en-GB': 'Message' }, name: 'message', type: 'textarea', required: true },
    { label: { 'en-GB': 'I agree' }, name: 'consent', type: 'consent', required: true },
  ],
  submitLabel: { 'en-GB': 'Send' },
  successMessage: { 'en-GB': 'Thanks' },
  ...extra,
});

/** The forms' block ids. */
const CONTACT = '00000000-0000-4000-8000-00000018f001';
const HIDDEN = '00000000-0000-4000-8000-00000018f002';
const DRAFT = '00000000-0000-4000-8000-00000018f003';
const MISSING = '00000000-0000-4000-8000-00000018f004';

const answers = { name: 'Ada Lovelace', email: 'ada@example.com', topic: 'Support', message: 'Hello there', consent: true };

describe.skipIf(!hasDatabase)('forms', () => {
  const run = Date.now();
  const mailer = new MemoryMailer();
  const turnstile: TurnstileConfig = { secretKey: '', requireKey: false };
  let app: INestApplication;
  let db: DbService;
  let space: string;
  let other: string;
  let admin: string;
  let editor: string;
  let author: string;
  let developer: string;
  let delivery: CreatedApiToken;
  let otherDelivery: CreatedApiToken;
  let page: Entry;
  let draft: Entry;

  const server = () => app.getHttpServer();
  const as = (token: string, spaceId = space) => ({
    get: (path: string) => request(server()).get(`/v1/management/spaces/${spaceId}${path}`).auth(token, { type: 'bearer' }),
    post: (path: string, body: object = {}) =>
      request(server()).post(`/v1/management/spaces/${spaceId}${path}`).auth(token, { type: 'bearer' }).send(body),
    put: (path: string, body: object) => request(server()).put(`/v1/management/spaces/${spaceId}${path}`).auth(token, { type: 'bearer' }).send(body),
    delete: (path: string) => request(server()).delete(`/v1/management/spaces/${spaceId}${path}`).auth(token, { type: 'bearer' }),
  });
  let visitor = 0;
  /** Each call comes from a new visitor unless `ip` says otherwise, so only the rate limit test meets the limit. */
  const submit = (formUid: string, body: object, token = delivery, ip = `203.0.113.${++visitor}`) =>
    request(server())
      .post(`/v1/delivery/forms/${formUid}/submit`)
      .auth(token.token, { type: 'bearer' })
      .set('X-Novan-Client-Ip', ip)
      .send(body);
  const kept = async (): Promise<FormSubmission[]> => (await as(editor).get('/forms/submissions')).body.items;
  const runNotifications = async (): Promise<void> => {
    while (await app.get(JobWorker).runOnce('notifications', { spaceId: space })) {
      // until none are left
    }
  };

  beforeAll(async () => {
    process.env['FORM_RATE_LIMIT'] = '4';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue({ enabled: false })
      .overrideProvider(Mailer)
      .useValue(mailer)
      .overrideProvider(JOBS_CONFIG)
      .useValue(jobs)
      .overrideProvider(TURNSTILE_CONFIG)
      .useValue(turnstile)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);
    [{ id: space }] = await db.serviceDb.insert(spaces).values({ organisationId, name: 'Forms', slug: `forms-${run}` }).returning({ id: spaces.id });
    [{ id: other }] = await db.serviceDb.insert(spaces).values({ organisationId, name: 'Elsewhere', slug: `forms-other-${run}` }).returning({ id: spaces.id });
    admin = await jwt(novanAdminId, space, 'admin');
    editor = await jwt(novanAdminId, space, 'editor');
    author = await jwt(novanAdminId, space, 'author');
    developer = await jwt(novanAdminId, space, 'developer');

    expect((await as(admin).post('/environments/main/block-types', formBlock)).status).toBe(201);
    const type = await as(admin).post('/environments/main/content-types', {
      apiId: 'page',
      name: 'Page',
      kind: 'page',
      fields: [
        field('title', 'text', { required: true, localised: true }),
        field('slug', 'text', { required: true }),
        field('body', 'blocks', { allowedBlocks: ['form'] }),
      ],
    });
    expect(type.status, JSON.stringify(type.body)).toBe(201);

    const created = await as(editor).post('/environments/main/entries', {
      contentType: 'page',
      data: {
        title: { 'en-GB': 'Contact' },
        slug: 'contact',
        body: [contactForm(CONTACT), contactForm(HIDDEN, { _hidden: true })],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    page = created.body;
    expect((await as(editor).post(`/environments/main/entries/${page.id}/publish`)).status).toBe(200);
    draft = (
      await as(editor).post('/environments/main/entries', {
        contentType: 'page',
        data: { title: { 'en-GB': 'Draft' }, slug: 'draft', body: [contactForm(DRAFT)] },
      })
    ).body;

    delivery = (await as(admin).post('/api-tokens', { name: 'Site', scope: 'delivery' })).body;
    otherDelivery = (await as(await jwt(novanAdminId, other, 'admin'), other).post('/api-tokens', { name: 'Other', scope: 'delivery' })).body;
    expect((await as(admin).put('/forms/settings', { recipients: ['office@example.com'], retentionMonths: 12 })).status).toBe(200);
  });

  afterAll(async () => {
    delete process.env['FORM_RATE_LIMIT'];
    for (const id of [space, other]) if (id) await db.serviceDb.delete(spaces).where(eq(spaces.id, id));
    await app?.close();
  });

  describe('sending a form', () => {
    it('keeps a valid submission and emails the recipients', async () => {
      const res = await submit(CONTACT, { entryId: page.id, data: { ...answers, name: '  Ada Lovelace ' } });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(res.headers['cache-control']).toBe('no-store');

      const [submission] = await kept();
      expect(submission).toMatchObject({
        entryId: page.id,
        formUid: CONTACT,
        formName: 'Get in touch',
        pagePath: '/contact',
        locale: 'en-GB',
        data: answers,
      });
      expect(submission.fields.map((f) => f.label)).toEqual(['Your name', 'Email', 'Topic', 'Message', 'I agree']);

      mailer.sent.length = 0;
      await runNotifications();
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0].to).toEqual(['office@example.com']);
      expect(mailer.sent[0].subject).toBe('New message from Get in touch on Forms');
      expect(mailer.sent[0].text).toContain('Message\nHello there');
      expect(mailer.sent[0].text).toContain(`/spaces/${space}/forms?submission=${submission.id}`);
    });

    it('checks the answers against the published form', async () => {
      const res = await submit(CONTACT, { entryId: page.id, data: { name: '', email: 'nope', topic: 'Other', extra: 'x' } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('form_invalid');
      expect(res.body.errors).toEqual({
        name: ['Fill in this field.'],
        email: ['Enter an email address, like name@example.com.'],
        topic: ['Choose one of the options.'],
        message: ['Fill in this field.'],
        consent: ['Tick this box to send the form.'],
        extra: ['This form does not ask for this.'],
      });
    });

    it.each([
      ['a form that does not exist', MISSING, () => page.id],
      ['a hidden form', HIDDEN, () => page.id],
      ['a form on a page that is not published', DRAFT, () => draft.id],
    ])('refuses %s', async (_, uid, entryId) => {
      const res = await submit(uid, { entryId: entryId(), data: answers });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('form_not_found');
    });

    it('refuses a form on another space\'s page', async () => {
      const res = await submit(CONTACT, { entryId: page.id, data: answers }, otherDelivery);
      expect(res.status).toBe(404);
    });

    it('drops what robots fill into the honeypot, without telling them', async () => {
      const before = (await kept()).length;
      const res = await submit(CONTACT, { entryId: page.id, data: answers, website: 'https://spam.example' });
      expect(res.status).toBe(202);
      expect(await kept()).toHaveLength(before);
    });

    it('checks the Turnstile response with Cloudflare when a secret key is set', async () => {
      const calls: URLSearchParams[] = [];
      let success = false;
      turnstile.secretKey = '2x0000000000000000000000000000000AA';
      turnstile.fetch = (async (_url: string, init: RequestInit) => {
        calls.push(init.body as URLSearchParams);
        return new Response(JSON.stringify({ success }));
      }) as typeof fetch;
      try {
        const before = (await kept()).length;
        expect((await submit(CONTACT, { entryId: page.id, data: answers }, delivery, '192.0.2.20')).body.code).toBe('spam_check_failed');
        expect(calls).toHaveLength(0);
        const refused = await submit(CONTACT, { entryId: page.id, data: answers, turnstileToken: 'robot' }, delivery, '192.0.2.20');
        expect(refused.body.code).toBe('spam_check_failed');
        expect(calls[0].get('response')).toBe('robot');
        expect(calls[0].get('remoteip')).toBe('192.0.2.20');
        expect(await kept()).toHaveLength(before);

        success = true;
        expect((await submit(CONTACT, { entryId: page.id, data: answers, turnstileToken: 'person' }, delivery, '192.0.2.20')).status).toBe(202);
        expect(await kept()).toHaveLength(before + 1);
      } finally {
        turnstile.secretKey = '';
        delete turnstile.fetch;
      }
    });

    it('limits how many forms one visitor sends a minute', async () => {
      const ip = '198.51.100.7';
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await submit(CONTACT, { entryId: page.id, data: answers }, delivery, ip)).status);
      expect(statuses).toEqual([202, 202, 202, 202, 429]);
      expect((await submit(CONTACT, { entryId: page.id, data: answers }, delivery, '198.51.100.8')).status).toBe(202);
    });
  });

  describe('the inbox', () => {
    it('lists forms and submissions, newest first, a page at a time', async () => {
      const forms: FormSummary[] = (await as(editor).get('/forms')).body;
      expect(forms).toEqual([expect.objectContaining({ formUid: CONTACT, formName: 'Get in touch', pagePath: '/contact', entryId: page.id })]);
      const total = forms[0].count;

      const first: FormSubmissionsPage = (await as(editor).get(`/forms/submissions?form=${CONTACT}&limit=2`)).body;
      expect(first.items).toHaveLength(2);
      const rest: FormSubmissionsPage = (await as(editor).get(`/forms/submissions?form=${CONTACT}&limit=100&cursor=${first.nextCursor}`)).body;
      expect(first.items.length + rest.items.length).toBe(total);
      expect(rest.nextCursor).toBeNull();
      expect(Date.parse(first.items[0].createdAt)).toBeGreaterThanOrEqual(Date.parse(first.items[1].createdAt));
    });

    it('is for admins and editors only', async () => {
      expect((await as(author).get('/forms/submissions')).status).toBe(403);
      expect((await as(developer).get('/forms/submissions')).status).toBe(403);
      expect((await as(admin).get('/forms/submissions')).status).toBe(200);
    });

    it('exports a form as CSV, defusing formulas, and audits it', async () => {
      expect((await submit(CONTACT, { entryId: page.id, data: { ...answers, name: '=HYPERLINK("http://x")' } }, delivery, '192.0.2.1')).status).toBe(202);
      const res = await as(editor).get(`/forms/submissions/export?form=${CONTACT}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="get-in-touch-submissions.csv"');
      const lines = res.text.replace(/^\uFEFF/, '').split('\r\n');
      expect(lines[0]).toBe('"Sent (UTC)","Page","Language","Your name","Email","Topic","Message","I agree"');
      expect(res.text).toContain('"\'=HYPERLINK(""http://x"")"');
      expect(lines[1]).toContain('"/contact","en-GB","Ada Lovelace","ada@example.com","Support","Hello there","Yes"');
      const [audit] = await db.serviceDb
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, space), eq(auditEvents.action, 'form_submissions.exported')));
      expect(audit.diff).toMatchObject({ formName: 'Get in touch' });
      expect(JSON.stringify(audit.diff)).not.toContain('ada@example.com');
    });

    it('deletes a submission, and audits it without the answers', async () => {
      const [submission] = await kept();
      expect((await as(author).delete(`/forms/submissions/${submission.id}`)).status).toBe(403);
      expect((await as(editor).delete(`/forms/submissions/${submission.id}`)).status).toBe(204);
      expect((await as(editor).get(`/forms/submissions/${submission.id}`)).status).toBe(404);
      const [audit] = await db.serviceDb
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, space), eq(auditEvents.action, 'form_submission.deleted'), eq(auditEvents.targetId, submission.id)));
      expect(audit).toBeDefined();
      expect(JSON.stringify(audit.diff)).not.toContain('ada@example.com');
    });

    it('lets admins, not editors, change who is emailed and how long submissions are kept', async () => {
      expect((await as(editor).get('/forms/settings')).body).toEqual({ recipients: ['office@example.com'], retentionMonths: 12 });
      expect((await as(editor).put('/forms/settings', { recipients: [], retentionMonths: 6 })).status).toBe(403);
      const res = await as(admin).put('/forms/settings', { recipients: ['Office@Example.com', 'sales@example.com'], retentionMonths: 6 });
      expect(res.body).toEqual({ recipients: ['office@example.com', 'sales@example.com'], retentionMonths: 6 } satisfies FormSettings);
      expect((await as(admin).put('/forms/settings', { recipients: ['nope'], retentionMonths: 6 })).status).toBe(400);
    });
  });

  it('deletes submissions older than the space\'s retention every night', async () => {
    await db.serviceDb.insert(formSubmissions).values([
      { spaceId: space, formUid: CONTACT, data: { name: 'Old' }, createdAt: sql`now() - interval '7 months'` },
      { spaceId: space, formUid: CONTACT, data: { name: 'Recent' }, createdAt: sql`now() - interval '5 months'` },
    ]);
    await app.get(FormsHousekeeping).purgeExpired();
    const names = (await kept()).map((submission) => submission.data['name']);
    expect(names).toContain('Recent');
    expect(names).not.toContain('Old');
  });
});
