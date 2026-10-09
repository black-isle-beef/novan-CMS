import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { DbService, entryVersions, spaces } from '@novan/api-db';
import { CloudflareClient } from '@novan/api-delivery';
import type {
  CreatedApiToken,
  DeliveryEntriesPage,
  DeliveryEntry,
  Entry,
  EntrySummary,
  MachineTranslation,
  ManagedLocales,
  Sitemap,
} from '@novan/shared-schemas';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// Localisation (docs/build/16-localisation.md). Needs the local Supabase database (`npm run db:start && npm run db:reset`).
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
const agencyId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const novanAdminId = '00000000-0000-4000-8000-000000000003';
const organisationId = '00000000-0000-4000-8000-000000000100';

function jwt(sub: string, spaces: { id: string; role: string }[]): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: 'aal1', spaces, agency_staff: false })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));
}

const field = (apiId: string, type: string, extra: object = {}) => ({ id: apiId, apiId, label: apiId, type, ...extra });

const cloudflare = {
  enabled: true,
  purgeTags: vi.fn<(tags: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
  purgeUrls: vi.fn<(urls: readonly string[]) => Promise<void>>().mockResolvedValue(undefined),
};

describe.skipIf(!hasDatabase)('localisation', () => {
  const run = Date.now();
  let app: INestApplication;
  let db: DbService;
  let space: string;
  let admin: string;
  let developer: string;
  let editor: string;
  let token: CreatedApiToken;
  let previewToken: CreatedApiToken;
  let about: Entry;
  let contact: Entry;

  const server = () => app.getHttpServer();
  const as = (user: string) => ({
    get: (path: string) => request(server()).get(`/v1/management/spaces/${space}${path}`).auth(user, { type: 'bearer' }),
    post: (path: string, body: object = {}) => request(server()).post(`/v1/management/spaces/${space}${path}`).auth(user, { type: 'bearer' }).send(body),
    put: (path: string, body: object) => request(server()).put(`/v1/management/spaces/${space}${path}`).auth(user, { type: 'bearer' }).send(body),
    patch: (path: string, body: object) => request(server()).patch(`/v1/management/spaces/${space}${path}`).auth(user, { type: 'bearer' }).send(body),
    delete: (path: string) => request(server()).delete(`/v1/management/spaces/${space}${path}`).auth(user, { type: 'bearer' }),
  });
  const delivery = (path: string) => request(server()).get(`/v1/delivery${path}`).auth(token.token, { type: 'bearer' });

  async function publish(body: object): Promise<Entry> {
    const created = await as(editor).post('/environments/main/entries', body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const published = await as(editor).post(`/environments/main/entries/${created.body.id}/publish`);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return published.body;
  }

  beforeAll(async () => {
    process.env['DELIVERY_RATE_LIMIT'] = '100000';
    // A translator that marks text, so machine translation can be tested without a provider.
    process.env['TRANSLATOR'] = 'pseudo';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(CloudflareClient)
      .useValue(cloudflare)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);

    const [created] = await db.serviceDb
      .insert(spaces)
      .values({ organisationId, name: 'Localisation', slug: `l10n-${run}` })
      .returning({ id: spaces.id });
    space = created.id;
    admin = await jwt(clientId, [{ id: space, role: 'admin' }]);
    developer = await jwt(agencyId, [{ id: space, role: 'developer' }]);
    editor = await jwt(novanAdminId, [{ id: space, role: 'editor' }]);

    const ok = (res: request.Response) => expect(res.status, JSON.stringify(res.body)).toBe(201);
    ok(await as(developer).post('/environments/main/block-types', { apiId: 'card', name: 'Card', fields: [field('heading', 'text', { localised: true })] }));
    ok(
      await as(developer).post('/environments/main/content-types', {
        apiId: 'page',
        name: 'Page',
        kind: 'page',
        fields: [
          field('title', 'text', { required: true, localised: true }),
          field('slug', 'text', { required: true }),
          field('summary', 'text', { localised: true, multiline: true }),
          field('cta', 'link', { localised: true }),
          field('notes', 'richText', { marks: ['link'] }),
          field('body', 'blocks', { allowedBlocks: ['card'] }),
        ],
      }),
    );
    ok(await as(developer).post('/environments/main/content-types', { apiId: 'post', name: 'Post', kind: 'entry', fields: [field('title', 'text', { localised: true })] }));
    token = (await as(developer).post('/api-tokens', { name: 'Site', scope: 'delivery' })).body;
    previewToken = (await as(developer).post('/api-tokens', { name: 'Previews', scope: 'preview' })).body;
  });

  afterAll(async () => {
    delete process.env['DELIVERY_RATE_LIMIT'];
    delete process.env['TRANSLATOR'];
    if (space) await db.serviceDb.delete(spaces).where(eq(spaces.id, space));
    await app?.close();
  });

  describe('locales', () => {
    it('a new space is in British English, with machine translation when a translator is set up', async () => {
      const res = await as(editor).get('/locales');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        locales: [{ code: 'en-GB', name: 'English (UK)', fallback: null, isDefault: true, prefix: 'en' }],
        prefixes: false,
        machineTranslation: true,
      });
    });

    it('editors cannot add locales', async () => {
      const res = await as(editor).post('/locales', { code: 'fr-FR', name: 'French' });
      expect(res.status).toBe(403);
    });

    it('a developer adds locales; the prefix defaults to the language', async () => {
      cloudflare.purgeTags.mockClear();
      const fr = await as(developer).post('/locales', { code: 'fr-FR', name: 'French (France)', fallback: 'en-GB' });
      expect(fr.status, JSON.stringify(fr.body)).toBe(201);
      const cy = await as(developer).post('/locales', { code: 'cy-GB', name: 'Welsh', prefix: 'cym' });
      const locales: ManagedLocales = cy.body;
      expect(locales.locales.map((l) => [l.code, l.fallback, l.prefix])).toEqual([
        ['en-GB', null, 'en'],
        ['fr-FR', 'en-GB', 'fr'],
        ['cy-GB', null, 'cym'],
      ]);
      // Every page of the space may read differently now.
      expect(cloudflare.purgeTags).toHaveBeenCalledWith(expect.arrayContaining([`space:${space}`]));
    });

    it('refuses a locale twice, a prefix twice, and fallbacks in a circle', async () => {
      expect((await as(developer).post('/locales', { code: 'fr-FR', name: 'Again' })).body.code).toBe('locale_exists');
      expect((await as(developer).post('/locales', { code: 'fr-CA', name: 'Canada', prefix: 'fr' })).body.code).toBe('prefix_taken');
      expect((await as(developer).post('/locales', { code: 'de-DE', name: 'German', fallback: 'nl-NL' })).body.code).toBe('fallback_not_found');
      expect((await as(developer).patch('/locales/cy-GB', { fallback: 'fr-FR' })).status).toBe(200);
      const circle = await as(developer).patch('/locales/fr-FR', { fallback: 'cy-GB' });
      expect(circle.status).toBe(400);
      expect(circle.body.code).toBe('fallback_circle');
      expect((await as(developer).patch('/locales/cy-GB', { fallback: null })).body.locales[2].fallback).toBeNull();
    });

    it('the default locale cannot be removed', async () => {
      const res = await as(developer).delete('/locales/en-GB');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('default_locale');
    });

    it('only space admins turn on locale prefixes', async () => {
      expect((await as(developer).put('/locales/prefixes', { prefixes: true })).status).toBe(403);
    });
  });

  describe('content models', () => {
    it('refuse to translate a group, blocks or a page slug', async () => {
      const group = await as(developer).post('/environments/main/content-types', {
        apiId: 'faq',
        name: 'FAQ',
        kind: 'entry',
        fields: [field('items', 'group', { localised: true, multiple: true, fields: [field('q', 'text', { localised: true })] })],
      });
      expect(group.status).toBe(400);
      const slug = await as(developer).post('/environments/main/content-types', {
        apiId: 'landing',
        name: 'Landing',
        kind: 'page',
        fields: [field('slug', 'text', { localised: true })],
      });
      expect(slug.status).toBe(400);
    });
  });

  describe('entries', () => {
    beforeAll(async () => {
      contact = await publish({ contentType: 'page', data: { title: { 'en-GB': 'Contact' }, slug: 'contact' } });
      about = await publish({
        contentType: 'page',
        data: {
          title: { 'en-GB': 'About', 'fr-FR': 'À propos' },
          slug: 'about',
          summary: { 'en-GB': 'Who we are' },
          cta: { 'en-GB': { type: 'internal', entryId: contact.id, text: 'Contact us' } },
          notes: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Write', marks: [{ type: 'link', attrs: { href: '/contact#form' } }] },
                  { type: 'text', text: ' or visit', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
                ],
              },
            ],
          },
          body: [{ _uid: '00000000-0000-4000-8000-0000000016c1', _block: 'card', heading: { 'en-GB': 'Hello', 'fr-FR': 'Bonjour' } }],
        },
      });
      await publish({ contentType: 'page', data: { title: { 'en-GB': 'Home', 'fr-FR': 'Accueil' }, slug: 'home' } });
      for (const [slug, en, fr] of [
        ['apple', 'Apple', 'Pomme'],
        ['cherry', 'Cherry', 'Cerise'],
        ['banana', 'Banana', null],
      ] as const) {
        await publish({ contentType: 'post', slug, data: { title: fr ? { 'en-GB': en, 'fr-FR': fr } : { 'en-GB': en } } });
      }
    });

    it('stores translations per locale and says which locales are missing some', async () => {
      expect(about.data['title']).toEqual({ 'en-GB': 'About', 'fr-FR': 'À propos' });
      expect(about.title).toBe('About');
      const list: EntrySummary[] = (await as(editor).get('/environments/main/entries?contentType=page')).body;
      const summary = list.find((entry) => entry.id === about.id);
      // French lacks the summary and the button; Welsh lacks everything.
      expect(summary?.missingTranslations).toEqual(['fr-FR', 'cy-GB']);
    });

    it('needs the default locale to publish, and drops locales the space does not have', async () => {
      const created = await as(editor).post('/environments/main/entries', {
        contentType: 'page',
        data: { title: { 'fr-FR': 'Seulement' }, slug: 'seulement', summary: { 'de-DE': 'Nur' } },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.data['summary']).toBeUndefined();
      const published = await as(editor).post(`/environments/main/entries/${created.body.id}/publish`);
      expect(published.status).toBe(400);
      expect(published.body.errors).toEqual({ 'title.en-GB': ['This field is required.'] });
    });
  });

  describe('delivery', () => {
    it('answers in the locale, with missing translations from its fallback', async () => {
      const res = await delivery('/pages?path=/about&locale=fr-FR');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const page: DeliveryEntry = res.body;
      expect(page).toMatchObject({ id: about.id, locale: 'fr-FR', path: '/about' });
      expect(page.data).toMatchObject({
        title: 'À propos',
        summary: 'Who we are',
        cta: { type: 'internal', text: 'Contact us', path: '/contact' },
        body: [{ _block: 'card', heading: 'Bonjour' }],
      });
    });

    it('answers in the default locale when none is asked for', async () => {
      const page: DeliveryEntry = (await delivery('/pages?path=/about')).body;
      expect(page).toMatchObject({ locale: 'en-GB', data: { title: 'About', body: [{ heading: 'Hello' }] } });
    });

    it('lists the locales the page is in as alternates', async () => {
      const page: DeliveryEntry = (await delivery('/pages?path=/about&locale=fr-FR')).body;
      expect(page.alternates).toEqual([
        { locale: 'en-GB', path: '/about' },
        { locale: 'fr-FR', path: '/about' },
      ]);
    });

    it('answers 404 for a locale with nothing to show and no fallback, and for one the site is not in', async () => {
      const welsh = await delivery('/pages?path=/about&locale=cy-GB');
      expect(welsh.status).toBe(404);
      expect(welsh.body.code).toBe('page_not_found');
      expect((await delivery('/pages?path=/about&locale=de-DE')).body.code).toBe('locale_not_found');
    });

    it('describes the site\'s locales', async () => {
      const res = await delivery('/locales');
      expect(res.status).toBe(200);
      expect(res.body.locales.map((l: { code: string }) => l.code)).toEqual(['en-GB', 'fr-FR', 'cy-GB']);
      expect(res.body).not.toHaveProperty('machineTranslation');
    });

    it('filters and sorts entries by their translated values, along the fallback', async () => {
      const sorted: DeliveryEntriesPage = (await delivery('/entries?type=post&locale=fr-FR&sort=fields.title')).body;
      expect(sorted.items.map((item) => item.data['title'])).toEqual(['Banana', 'Cerise', 'Pomme']);
      const filtered: DeliveryEntriesPage = (await delivery('/entries?type=post&locale=fr-FR&fields.title[eq]=Pomme')).body;
      expect(filtered.items.map((item) => item.data['title'])).toEqual(['Pomme']);
    });

    it('with locale prefixes on, gives addresses on the site in each locale', async () => {
      const on = await as(admin).put('/locales/prefixes', { prefixes: true });
      expect(on.status, JSON.stringify(on.body)).toBe(200);
      const page: DeliveryEntry = (await delivery('/pages?path=/about&locale=fr-FR')).body;
      expect(page.path).toBe('/fr/about');
      expect(page.data['cta']).toMatchObject({ path: '/fr/contact' });
      // Site addresses typed into rich text stay in the locale; other links are left alone.
      const hrefs = JSON.stringify(page.data['notes']).match(/"href":"[^"]+"/g);
      expect(hrefs).toEqual(['"href":"/fr/contact#form"', '"href":"https://example.com"']);
      expect(page.alternates).toEqual([
        { locale: 'en-GB', path: '/about' },
        { locale: 'fr-FR', path: '/fr/about' },
      ]);
      expect((await delivery('/pages?path=/&locale=fr-FR')).body.path).toBe('/fr');
    });

    it('lists each page once per locale it is in in the sitemap', async () => {
      const sitemap: Sitemap = (await delivery('/sitemap')).body;
      const aboutItems = sitemap.items.filter((item) => item.id === about.id);
      expect(aboutItems.map((item) => [item.locale, item.path])).toEqual([
        ['en-GB', '/about'],
        ['fr-FR', '/fr/about'],
      ]);
      expect(sitemap.items.some((item) => item.locale === 'cy-GB')).toBe(false);
    });

    it('previews unsaved changes in a locale', async () => {
      const res = await as(editor).post(`/environments/main/entries/${about.id}/preview-data`, {
        data: { title: { 'en-GB': 'About', 'fr-FR': 'À propos de nous' }, slug: 'about' },
        locale: 'fr-FR',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ locale: 'fr-FR', path: '/fr/about', data: { title: 'À propos de nous' } });
      expect(previewToken.token).toMatch(/^nv_pre_/);
    });
  });

  describe('machine translation', () => {
    it('fills the empty translations as a draft marked as machine-translated', async () => {
      const res = await as(editor).post(`/environments/main/entries/${about.id}/translate`, { to: 'fr-FR' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const result: MachineTranslation = res.body;
      expect(result.provider).toBe('Pseudo-translation');
      expect(result.translated).toEqual(['summary', 'cta']);
      expect(result.entry.data['title']).toEqual({ 'en-GB': 'About', 'fr-FR': 'À propos' });
      expect(result.entry.data['summary']).toEqual({ 'en-GB': 'Who we are', 'fr-FR': '[fr-FR] Who we are' });
      expect(result.entry.data['cta']).toMatchObject({ 'fr-FR': { type: 'internal', entryId: contact.id, text: '[fr-FR] Contact us' } });
      expect(result.entry.hasUnpublishedChanges).toBe(true);

      const [version] = await db.serviceDb.select({ message: entryVersions.message }).from(entryVersions).where(eq(entryVersions.id, result.entry.currentVersionId));
      expect(version.message).toBe('Machine-translated draft (French (France)). Check every translation before publishing.');
      // Nothing reaches the site until someone publishes it.
      expect((await delivery('/pages?path=/about&locale=fr-FR')).body.data['summary']).toBe('Who we are');
    });

    it('refuses a locale the space does not have', async () => {
      const res = await as(editor).post(`/environments/main/entries/${about.id}/translate`, { to: 'de-DE' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('locale_not_found');
    });
  });
});
