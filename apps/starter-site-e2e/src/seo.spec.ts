import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { anonKey, management } from './support/management';

// SEO and site features (docs/build/14-seo-site-features.md) on the seeded demo site (`npm run db:reset`): what the
// server sends search engines, the seeded redirect, and misses reported to the CMS. Journeys that publish are in
// seo-publish.spec.ts.

/** Every `application/ld+json` block in the HTML, parsed. */
function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
}

const meta = (html: string, attribute: string, name: string) =>
  new RegExp(`<meta[^>]*${attribute}="${name.replace(/[:.]/g, '\\$&')}"[^>]*content="([^"]*)"|<meta[^>]*content="([^"]*)"[^>]*${attribute}="${name.replace(/[:.]/g, '\\$&')}"`).exec(html)?.slice(1).find(Boolean) ?? null;

test.describe('@seo', () => {
  test('pages are served with their meta tags, canonical address, sharing image and structured data', async ({ request, baseURL }) => {
    const html = await (await request.get('/about')).text();

    expect(meta(html, 'name', 'description')).toBe('How the Novan demo site is built.');
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="${baseURL}/about">`));
    expect(meta(html, 'property', 'og:url')).toBe(`${baseURL}/about`);
    expect(meta(html, 'property', 'og:title')).toBe('About');
    expect(meta(html, 'property', 'og:site_name')).toBe('Novan demo site');
    // The page has no sharing image of its own, so the site's (site settings) is used.
    expect(meta(html, 'property', 'og:image')).toContain('/v1/assets/00000000-0000-4000-8000-000000000501/shapes-navy.jpg');
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
    expect(meta(html, 'name', 'robots')).toBeNull();

    const data = jsonLd(html);
    expect(data).toContainEqual(
      expect.objectContaining({
        '@type': 'Organization',
        name: 'Novan Web Services',
        url: `${baseURL}/`,
        email: 'hello@example.com',
        sameAs: ['https://www.linkedin.com/company/example'],
      }),
    );
    expect(data).toContainEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Novan demo site', item: `${baseURL}/` },
        { '@type': 'ListItem', position: 2, name: 'About', item: `${baseURL}/about` },
      ],
    });
  });

  test('the footer shows the contact details and social media from site settings', async ({ page }) => {
    await page.goto('/contact');
    const footer = page.getByRole('contentinfo');

    await expect(footer.getByRole('link', { name: 'hello@example.com' })).toHaveAttribute('href', 'mailto:hello@example.com');
    await expect(footer.getByRole('list', { name: 'Social media' }).getByRole('link', { name: 'LinkedIn' })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/company/example',
    );
    await expectNoAxeViolations(page);
  });

  test('an old address redirects permanently before anything renders, keeping the query', async ({ request, page }) => {
    const response = await request.get('/about-us/?utm_source=mail', { maxRedirects: 0 });

    expect(response.status()).toBe(301);
    expect(response.headers()['location']).toBe('/about?utm_source=mail');
    expect(response.headers()['cache-tag']).toContain('redirects:00000000-0000-4000-8000-000000000200');

    await page.goto('/about-us');
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole('heading', { level: 1, name: 'About this site' })).toBeVisible();
  });

  test('an address with no page is reported to the CMS, for its missing pages list', async ({ request }, testInfo) => {
    test.skip(!anonKey, 'needs SUPABASE_ANON_KEY (.env.local)');
    const path = `/seo-missing-${testInfo.project.name}-${Date.now()}`;

    expect((await request.get(path, { headers: { referer: 'https://www.example.org/links' } })).status()).toBe(404);

    const api = await management(request);
    await expect
      .poll(async () => ((await api.get('/not-found?days=1&limit=200')) as { path: string }[]).find((row) => row.path === path), {
        message: `${path} among the missing pages`,
      })
      .toMatchObject({ path, hits: 1, lastReferrer: 'https://www.example.org/links' });
  });
});
