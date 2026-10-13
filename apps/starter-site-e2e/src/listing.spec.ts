import { expect, type APIRequestContext, request as playwrightRequest, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectNoAxeViolations } from './support/axe';
import { waitForHydration } from './support/hydration';
import { anonKey, demoSpace } from './support/management';

// The blog starter kit on the site (docs/build/19-schema-cli-starter-kits.md): the listing block in every tone, in a
// real browser (axe checks contrast here, which jsdom cannot), a post opened from it, and the RSS feed. The demo space
// has no blog, so this adds the kit's `post` type and `listing` block for the test and takes them away again. It
// changes the content model, so it runs once, in chromium, after everything else (playwright.config.mts).

const root = resolve(__dirname, '../../..');
const supabaseUrl = process.env['SUPABASE_URL'] || 'http://127.0.0.1:54321';
const apiUrl = process.env['NOVAN_API_URL'] || 'http://localhost:3000';
const model = `${apiUrl}/v1/management/spaces/${demoSpace}/environments/main`;

const listingType = (JSON.parse(readFileSync(resolve(root, 'libs/blocks/block-types.json'), 'utf8')) as { blockTypes: { apiId: string }[] }).blockTypes.find(
  (type) => type.apiId === 'listing',
);
const postType = JSON.parse(readFileSync(resolve(root, 'kits/blog/schema/content-types/post.json'), 'utf8')) as object;

async function adminApi(request: APIRequestContext) {
  const signIn = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: { email: 'novanwebservices@gmail.com', password: 'password123' },
  });
  expect(signIn.ok(), await signIn.text()).toBe(true);
  const headers = { Authorization: `Bearer ${(await signIn.json()).access_token}` };
  const call = async (method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: object) => {
    const res = await request[method](`${model}${path}`, { headers, data });
    expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
    return res.status() === 204 ? null : res.json();
  };
  return { call, exists: async (path: string) => (await request.get(`${model}${path}`, { headers })).ok() };
}

test.describe('@kits listing block and blog feed', () => {
  test.skip(!anonKey, 'needs SUPABASE_ANON_KEY (.env.local)');
  // One worker for the whole block, so the setup and the clean-up each run once, even when a test fails.
  test.describe.configure({ mode: 'serial' });

  const slug = `e2e-listing-${Date.now()}`;
  const created: string[] = [];
  let originalPageFields: unknown;
  let context: APIRequestContext;
  let api: Awaited<ReturnType<typeof adminApi>>;

  // Its own request context: the test's `request` fixture cannot be used again in afterAll.
  test.beforeAll(async () => {
    context = await playwrightRequest.newContext();
    api = await adminApi(context);
    if (!(await api.exists('/block-types/listing'))) await api.call('post', '/block-types', listingType);
    if (!(await api.exists('/content-types/post'))) await api.call('post', '/content-types', postType);
    const pageType = await api.call('get', '/content-types/page');
    originalPageFields = pageType.fields;
    const fields = structuredClone(pageType.fields) as { apiId: string; allowedBlocks?: string[] }[];
    const body = fields.find((field) => field.apiId === 'body');
    if (body?.allowedBlocks && !body.allowedBlocks.includes('listing')) body.allowedBlocks.push('listing');
    await api.call('patch', '/content-types/page', { fields });

    const publish = async (contentType: string, data: Record<string, unknown>) => {
      const entry = await api.call('post', '/entries', { contentType, data });
      created.push(entry.id);
      await api.call('post', `/entries/${entry.id}/publish`, {});
    };
    await publish('post', { title: 'An older post', slug: `${slug}-older`, summary: 'Written first.', publishedOn: '2026-01-05' });
    await publish('post', { title: 'The newest post', slug: `${slug}-newer`, summary: 'Written last.', publishedOn: '2026-03-09' });
    await publish('page', {
      title: 'Listing tones',
      slug,
      body: ['light', 'brand', 'dark'].map((tone) => ({
        _uid: randomUUID(),
        _block: 'listing',
        _style: { tone },
        heading: `Posts on ${tone}`,
        intro: 'The newest first.',
        source: 'post',
        limit: 2,
      })),
    });
  });

  test.afterAll(async () => {
    for (const id of created.reverse()) await api.call('delete', `/entries/${id}`);
    await api.call('patch', '/content-types/page', { fields: originalPageFields });
    await api.call('delete', '/content-types/post?force=true');
    await api.call('delete', '/block-types/listing?force=true');
    await context.dispose();
  });

  test('lists the newest posts in every tone without accessibility problems, and opens one', async ({ page }) => {
    await page.goto(`/${slug}`);
    await waitForHydration(page);

    const listings = page.locator('novan-listing-block');
    await expect(listings).toHaveCount(3);
    for (const listing of await listings.all()) {
      await expect(listing.getByRole('listitem').getByRole('link')).toHaveText(['The newest post', 'An older post']);
      await expect(listing.locator('time').first()).toHaveAttribute('datetime', '2026-03-09');
    }
    await expectNoAxeViolations(page);

    await listings.first().getByRole('link', { name: 'The newest post' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}-newer$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The newest post');
  });

  test('offers the posts as an RSS feed', async ({ request }) => {
    const feed = await request.get('/rss.xml');

    expect(feed.headers()['content-type']).toContain('application/rss+xml');
    const xml = await feed.text();
    expect(xml.indexOf('<title>The newest post</title>')).toBeGreaterThan(-1);
    expect(xml.indexOf('<title>The newest post</title>')).toBeLessThan(xml.indexOf('<title>An older post</title>'));
  });
});
