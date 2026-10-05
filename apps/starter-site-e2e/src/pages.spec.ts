import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { waitForHydration } from './support/hydration';

// The pages supabase/seed.sql publishes (`npm run db:reset`). Between them they use all five blocks and
// every tone, so the axe scans below check colour contrast for each block in a real browser.
const pages = [
  { path: '/', title: 'Home | Novan demo site', heading: 'Welcome to the Novan demo site', text: 'What the starter site shows' },
  { path: '/about', title: 'About | Novan demo site', heading: 'About this site', text: 'How the pages are made' },
  { path: '/contact', title: 'Contact | Novan demo site', heading: 'Contact', text: 'Prefer to write now?' },
];

for (const { path, title, heading, text } of pages) {
  test(`${path} is rendered on the server from the CMS, cached at the edge, and accessible`, async ({ page, request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, s-maxage=31536000, stale-while-revalidate=60');
    expect(response.headers()['cache-tag']).toMatch(/(^|,)entry:[0-9a-f-]{36}(,|$)/);
    // View source: the content is in the HTML the server sends.
    const html = await response.text();
    expect(html).toContain(heading);
    expect(html).toContain(text);
    expect(html).toContain(`<title>${title}</title>`);

    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toContainText('Novan Web Services');
    await expectNoAxeViolations(page);
  });
}

test('an address with no page answers 404 with the CMS "page not found" content', async ({ page, request }) => {
  const response = await request.get('/no-such-page');
  expect(response.status()).toBe(404);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['cache-tag']).toBeUndefined();

  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
  await expectNoAxeViolations(page);
});

test('navigating between pages happens in the browser and moves focus to the new content', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'About' }).click();

  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1, name: 'About this site' })).toBeVisible();
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveTitle('About | Novan demo site');
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
});

test('the skip link moves focus to the main content without leaving the page', async ({ page }) => {
  await page.goto('/about');
  await waitForHydration(page);
  // Focused directly: WebKit, like Safari by default, does not Tab to links.
  await page.getByRole('link', { name: 'Skip to main content' }).focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('main')).toBeFocused();
});

test('the image block shows the seeded image with its alt text', async ({ page }) => {
  await page.goto('/about');
  const image = page.getByRole('img', { name: /overlapping navy, purple and grey circles/ });

  await expect(image).toBeVisible();
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test('sitemap.xml lists the published pages, and robots.txt points at it', async ({ request, baseURL }) => {
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toContain('application/xml');
  expect(sitemap.headers()['cache-tag']).toContain('sitemap:');
  const xml = await sitemap.text();
  for (const { path } of pages) expect(xml).toContain(`<loc>${baseURL}${path}</loc>`);
  expect(xml).not.toContain('site-settings');

  const robots = await request.get('/robots.txt');
  expect(await robots.text()).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
});

test('/health answers without caching', async ({ request }) => {
  const health = await request.get('/health');

  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });
  expect(health.headers()['cache-control']).toBe('no-store');
});
