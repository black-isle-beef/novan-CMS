import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { rejectCookies } from './support/consent';

const pages = [
  { path: '/', title: 'Novan CMS: a simple CMS your clients can run themselves', heading: 'Websites your clients can run themselves' },
  { path: '/features', title: 'Features | Novan CMS', heading: 'Features' },
  { path: '/pricing', title: 'Pricing | Novan CMS', heading: 'Pricing' },
  { path: '/contact', title: 'Contact us | Novan CMS', heading: 'Contact us' },
  { path: '/privacy', title: 'Privacy policy | Novan CMS', heading: 'Privacy policy' },
  { path: '/cookies', title: 'Cookie policy | Novan CMS', heading: 'Cookie policy' },
  { path: '/accessibility', title: 'Accessibility statement | Novan CMS', heading: 'Accessibility statement' },
];

for (const { path, title, heading } of pages) {
  test(`${path} is rendered on the server with its SEO, cached at the edge, and accessible`, async ({ page, request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    const html = await response.text();
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(heading);
    expect(html.match(/<link rel="canonical"/g)).toHaveLength(1);
    expect(html).toMatch(/<meta name="description" content="[^"]+">/);
    expect(html).toMatch(/<meta property="og:title" content="[^"]+">/);
    expect(html).toContain('<html lang="en-GB" data-bs-theme="dark" data-ds-theme="copper">');
    // The banner is only ever opened in the browser, so cached pages are the same for everyone.
    expect(html).not.toContain('ds-cookie-banner__region');

    await rejectCookies(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toHaveAttribute('id', 'ds-main-content');
    await expect(page.getByRole('contentinfo')).toContainText('Novan Web Services');
    await expectNoAxeViolations(page);
  });

  test(`${path} fits a 320px screen without scrolling sideways`, async ({ page }) => {
    await rejectCookies(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
}

test('the home page carries Organization and SoftwareApplication structured data', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const scripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].map((match) => JSON.parse(match[1]));
  expect(scripts.map((data) => data['@type']).sort()).toEqual(['Organization', 'SoftwareApplication']);

  const features = await (await request.get('/features')).text();
  expect(features).not.toContain('application/ld+json');
});

test('an unknown address answers 404 with a branded page kept out of search results', async ({ page, request }) => {
  const response = await request.get('/no-such-page');
  expect(response.status()).toBe(404);
  expect(response.headers()['cache-control']).toBe('no-store');
  const html = await response.text();
  expect(html).toContain('<meta name="robots" content="noindex, follow">');
  expect(html).not.toContain('rel="canonical"');

  await rejectCookies(page);
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
  await expectNoAxeViolations(page);
});

test('sitemap.xml lists every page but the 404, and robots.txt points to it', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
  expect(locs).toEqual(pages.map((page) => page.path));

  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/^Sitemap: https?:\/\/[^/]+\/sitemap\.xml$/m);
  expect(robots).toContain('Disallow: /_novan/');
});
