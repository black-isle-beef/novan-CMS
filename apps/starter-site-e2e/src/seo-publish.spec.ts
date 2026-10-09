import { expect, test } from '@playwright/test';
import { anonKey, contactPage, management } from './support/management';

// SEO journeys that publish (docs/build/14-seo-site-features.md). They change seeded content, so they run in their
// own project, once, after the other tests have read it (playwright.config.mts), and put it back.

test.describe('@seo publishing', () => {
  test.skip(!anonKey, 'needs SUPABASE_ANON_KEY (.env.local)');

  test('changing a page slug makes its old address a working 301', async ({ request, page }) => {
    const api = await management(request);
    try {
      await api.publish(contactPage, (data) => ({ ...data, slug: 'get-in-touch' }));

      // The site reuses the CMS's redirects for a few seconds (NOVAN_REDIRECTS_MAX_AGE_MS).
      await expect
        .poll(async () => {
          const response = await request.get('/contact', { maxRedirects: 0 });
          return `${response.status()} ${response.headers()['location'] ?? ''}`;
        }, { timeout: 15_000 })
        .toBe('301 /get-in-touch');
      await page.goto('/contact');
      await expect(page).toHaveURL(/\/get-in-touch$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Contact' })).toBeVisible();
    } finally {
      await api.publish(contactPage, (data) => ({ ...data, slug: 'contact' }));
      await expect.poll(async () => (await request.get('/contact', { maxRedirects: 0 })).status(), { timeout: 15_000 }).toBe(200);
    }
  });

  test('a new page appears in the sitemap; one hidden from search engines says noindex and stays out', async ({ request, baseURL }) => {
    const api = await management(request);
    const run = Date.now();
    const shown = await api.publishNewPage({ title: 'Seo shown', slug: `seo-shown-${run}` });
    const hidden = await api.publishNewPage({ title: 'Seo hidden', slug: `seo-hidden-${run}`, seo: { noindex: true } });
    try {
      const sitemap = await (await request.get('/sitemap.xml')).text();
      expect(sitemap).toContain(`<loc>${baseURL}/seo-shown-${run}</loc>`);
      expect(sitemap).not.toContain(`seo-hidden-${run}`);

      const html = await (await request.get(`/seo-hidden-${run}`)).text();
      expect(html).toMatch(/<meta name="robots" content="noindex">/);
      expect(await (await request.get(`/seo-shown-${run}`)).text()).not.toContain('noindex');
    } finally {
      await api.remove(shown);
      await api.remove(hidden);
    }
  });
});
