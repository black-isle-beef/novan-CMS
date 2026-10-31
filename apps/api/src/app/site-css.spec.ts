import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { DbService, environments, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import { JobWorker } from '@novan/api-jobs';
import type { CreatedApiToken, Entry } from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// The custom HTML block's CSS in the site's stylesheet (`customHtml` in @novan/blocks). Needs the local Supabase
// database (`npm run db:start && npm run db:reset`).
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';
process.env['PUBLIC_API_URL'] = 'https://api.novan.test';

const secret = 'test-secret-with-at-least-32-characters!';
const agencyId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const organisationId = '00000000-0000-4000-8000-000000000100';

/** The block type as `novan blocks sync` pushes it. */
const customHtmlType = (
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../libs/blocks/block-types.json'), 'utf8')) as { blockTypes: { apiId: string }[] }
).blockTypes.find((type) => type.apiId === 'customHtml');

function jwt(sub: string, spaceId: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: 'aal1', spaces: [{ id: spaceId, role: 'developer' }], agency_staff: false })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));
}

const cloudflare = {
  enabled: true,
  purgeTags: vi.fn<(tags: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
  purgeUrls: vi.fn<(urls: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
};

describe.skipIf(!hasDatabase)('the site stylesheet of custom HTML blocks', () => {
  const run = Date.now();
  let app: INestApplication;
  let db: DbService;
  let spaceA: string;
  let spaceB: string;
  let envA: string;
  let envB: string;
  let developerA: string;
  let developerB: string;
  let deliveryA: CreatedApiToken;
  let previewA: CreatedApiToken;
  let page: Entry;
  const blockUid = randomUUID();

  const server = () => app.getHttpServer();
  const manage = (spaceId: string, as: string) => ({
    post: (path: string, body: object = {}) =>
      request(server()).post(`/v1/management/spaces/${spaceId}/environments/main${path}`).auth(as, { type: 'bearer' }).send(body),
    patch: (path: string, body: object) =>
      request(server()).patch(`/v1/management/spaces/${spaceId}/environments/main${path}`).auth(as, { type: 'bearer' }).send(body),
  });
  const ok = (res: request.Response, status = 201) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body;
  };
  const stylesheet = (environmentId: string) => request(server()).get(`/v1/site-css/${environmentId}/blocks.css`);
  const siteStyles = (scope: 'delivery' | 'preview', token: CreatedApiToken) =>
    request(server()).get(`/v1/${scope}/site-styles`).auth(token.token, { type: 'bearer' });
  const mainEnvironment = async (spaceId: string) =>
    (await db.serviceDb.select({ id: environments.id }).from(environments).where(and(eq(environments.spaceId, spaceId), eq(environments.isMain, true))))[0].id;
  const runPurges = async (spaceId: string): Promise<void> => {
    while (await app.get(JobWorker).runOnce('purge', { spaceId })) {
      // until none are left
    }
  };

  /** A page type whose body takes the custom HTML block, in the space. */
  async function model(spaceId: string, as: string): Promise<void> {
    const env = manage(spaceId, as);
    ok(await env.post('/block-types', customHtmlType as object));
    ok(
      await env.post('/content-types', {
        apiId: 'page',
        name: 'Page',
        kind: 'page',
        fields: [
          { id: 'title', apiId: 'title', label: 'Title', type: 'text', required: true },
          { id: 'body', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: ['customHtml'] },
        ],
      }),
    );
  }

  beforeAll(async () => {
    process.env['DELIVERY_RATE_LIMIT'] = '100000';
    process.env['PREVIEW_RATE_LIMIT'] = '100000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue(cloudflare)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);

    const [a, b] = await db.serviceDb
      .insert(spaces)
      .values([
        { organisationId, name: 'Site CSS A', slug: `site-css-a-${run}` },
        { organisationId, name: 'Site CSS B', slug: `site-css-b-${run}` },
      ])
      .returning({ id: spaces.id });
    spaceA = a.id;
    spaceB = b.id;
    envA = await mainEnvironment(spaceA);
    envB = await mainEnvironment(spaceB);
    developerA = await jwt(agencyId, spaceA);
    developerB = await jwt(clientId, spaceB);
    await model(spaceA, developerA);
    await model(spaceB, developerB);

    const tokens = (path: string, body: object) =>
      request(server()).post(`/v1/management/spaces/${spaceA}${path}`).auth(developerA, { type: 'bearer' }).send(body);
    deliveryA = ok(await tokens('/api-tokens', { name: 'Website', scope: 'delivery' }));
    previewA = ok(await tokens('/api-tokens', { name: 'Previews', scope: 'preview' }));
  });

  afterAll(async () => {
    delete process.env['DELIVERY_RATE_LIMIT'];
    delete process.env['PREVIEW_RATE_LIMIT'];
    if (spaceA) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceA));
    if (spaceB) await db.serviceDb.delete(spaces).where(eq(spaces.id, spaceB));
    await app?.close();
  });

  it('is empty, and not linked, before any block with CSS is published', async () => {
    const res = await stylesheet(envA);
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
    expect(ok(await siteStyles('delivery', deliveryA), 200).stylesheets).toEqual([]);
  });

  it('holds the CSS of published blocks only, cleaned and scoped to each block', async () => {
    const env = manage(spaceA, developerA);
    page = ok(
      await env.post('/entries', {
        contentType: 'page',
        slug: 'home',
        data: {
          title: 'Home',
          body: [
            {
              _uid: blockUid,
              _block: 'customHtml',
              html: '<div class="hours"><h2>Opening hours</h2></div>',
              css: '.hours h2 { color: rebeccapurple } @import url(https://evil.example/x.css); .x { behavior: url(x.htc) }',
            },
            { _uid: randomUUID(), _block: 'customHtml', _hidden: true, html: '<p>Later</p>', css: '.later { color: red }' },
          ],
        },
      }),
    );
    // A draft is not on the site.
    expect((await stylesheet(envA)).text).toBe('');

    cloudflare.purgeTags.mockClear();
    ok(await env.post(`/entries/${page.id}/publish`), 200);
    await runPurges(spaceA);
    expect(cloudflare.purgeTags.mock.calls.flat(2)).toContain(`entries:${envA}`);

    const res = await stylesheet(envA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.headers['cache-tag']).toBe(`space:${spaceA},entries:${envA},site-styles:${envA}`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.text.startsWith('@layer novan-base, ds-vendor, ds-components, novan-overrides;\n')).toBe(true);
    expect(res.text).toContain(`@layer novan-overrides {\n[data-novan-custom-html="${blockUid}"] {\n.hours h2 { color: rebeccapurple }`);
    expect(res.text).not.toMatch(/evil|behavior|later/);
  });

  it('is linked from Delivery site-styles, last, but never from Preview', async () => {
    const delivered = await siteStyles('delivery', deliveryA);
    expect(ok(delivered, 200).stylesheets).toEqual([
      { href: `https://api.novan.test/v1/site-css/${envA}/blocks.css`, designSystem: '_custom-html', version: expect.stringMatching(/^[0-9a-f]{12}$/) },
    ]);
    expect(delivered.headers['cache-tag']).toContain(`entries:${envA}`);
    expect(ok(await siteStyles('preview', previewA), 200).stylesheets).toEqual([]);
  });

  it('keeps the published CSS until the next publish, and drops it on unpublish', async () => {
    const env = manage(spaceA, developerA);
    const draft = {
      title: 'Home',
      body: [{ _uid: blockUid, _block: 'customHtml', html: '<div class="hours"></div>', css: '.hours { margin: 0 }' }],
    };
    ok(await env.patch(`/entries/${page.id}`, { data: draft }), 200);
    expect((await stylesheet(envA)).text).toContain('rebeccapurple');

    ok(await env.post(`/entries/${page.id}/publish`), 200);
    const republished = (await stylesheet(envA)).text;
    expect(republished).toContain('.hours { margin: 0 }');
    expect(republished).not.toContain('rebeccapurple');

    ok(await env.post(`/entries/${page.id}/unpublish`), 200);
    expect((await stylesheet(envA)).text).toBe('');
  });

  it("never holds another space's CSS", async () => {
    const env = manage(spaceB, developerB);
    const other = ok(
      await env.post('/entries', {
        contentType: 'page',
        slug: 'home',
        data: { title: 'B', body: [{ _uid: randomUUID(), _block: 'customHtml', html: '<p>B</p>', css: '.only-b { color: red }' }] },
      }),
    );
    ok(await env.post(`/entries/${other.id}/publish`), 200);

    expect((await stylesheet(envB)).text).toContain('.only-b');
    expect((await stylesheet(envA)).text).not.toContain('.only-b');
  });

  it('answers an unknown environment with 404, and a malformed id with 400', async () => {
    expect((await stylesheet(randomUUID())).status).toBe(404);
    expect((await stylesheet('not-an-id')).status).toBe(400);
  });
});
