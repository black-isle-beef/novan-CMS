import { expect, test } from '@playwright/test';
import { client, signIn } from './support/auth';
import { expectNoAxeViolations } from './support/axe';
import { keepPublished } from './support/management';

// Site settings, navigation, redirects, missing pages and the visual editor's SEO tab (docs/build/14-seo-site-
// features.md), as the seeded client: an editor of the demo space, in client mode. Needs local Supabase
// (`npm run db:start && npm run db:reset`); the API, admin and starter site start automatically.

const space = '00000000-0000-4000-8000-000000000200';
const navigation = '00000000-0000-4000-8000-000000000711';
const siteSettings = '00000000-0000-4000-8000-000000000712';
const about = '00000000-0000-4000-8000-000000000702';
/** Words client roles must never see (as in shell.spec.ts). */
const agencyOnlyWords = /\b(entry|entries|environments?|content\s+types?)\b/i;

test.describe('@seo', () => {
  test('an editor changes the site settings and publishes them', async ({ page, request }) => {
    const putBack = await keepPublished(request, space, siteSettings);
    try {
      await signIn(page, client);
      await page.getByRole('link', { name: 'Demo site' }).click();
      await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Settings' }).click();
      await page.getByRole('link', { name: 'Site settings' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Site settings' })).toBeVisible();
      await expect(page).toHaveTitle('Site settings | Novan CMS');
      await expect(page.getByLabel('Site name (required)')).toHaveValue('Novan demo site');
      await expect(page.getByRole('main')).not.toContainText(agencyOnlyWords);
      await expectNoAxeViolations(page);

      // A malformed value is caught before saving, and the summary links to it.
      await page.getByLabel('Google Analytics measurement ID').fill('UA-1234');
      await page.getByRole('button', { name: 'Publish changes' }).click();
      const summary = page.getByRole('alert').filter({ hasText: 'Fix these first' });
      await expect(summary).toBeFocused();
      await expectNoAxeViolations(page);

      await page.getByLabel('Google Analytics measurement ID').fill('');
      await page.getByLabel('Phone number').fill('+44 20 7946 0000');
      await page.getByRole('button', { name: 'Publish changes' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Published' })).toBeVisible();
    } finally {
      await putBack();
    }
  });

  test('an editor rearranges the main menu in the navigation editor', async ({ page, request }) => {
    const putBack = await keepPublished(request, space, navigation);
    try {
      await signIn(page, client);
      await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
      await page.goto(`/spaces/${space}/settings/navigation`);
      await expect(page.getByRole('heading', { level: 1, name: 'Navigation' })).toBeVisible();
      const menu = page.getByRole('region', { name: 'Main menu' });
      await expect(menu.getByLabel('Label (required)').nth(2)).toHaveValue('Contact');
      await expectNoAxeViolations(page);

      // Contact becomes a sub-link of About; focus stays on the moved item, and the move is announced.
      await menu.getByRole('button', { name: 'Make it a sub-link of “About”' }).click();
      await expect(page.getByRole('button', { name: 'Make it a menu item' })).toBeFocused();
      await expect(page.getByRole('status').filter({ hasText: 'Moved into “About” as sub-link 1.' })).toBeAttached();
      await expect(menu.getByRole('heading', { name: 'Sub-links of “About”' })).toBeVisible();
      await expectNoAxeViolations(page);

      await page.getByRole('button', { name: 'Publish changes' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Published' })).toBeVisible();
    } finally {
      await putBack();
    }
  });

  test('an editor adds a redirect for a missing page, and deletes it', async ({ page }, testInfo) => {
    const missing = `/e2e-missing-${testInfo.project.name}-${Date.now()}`;
    // The demo site reports the miss to the CMS.
    expect((await page.request.get(`http://localhost:4300${missing}`)).status()).toBe(404);

    await signIn(page, client);
    await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
    await page.goto(`/spaces/${space}/settings/missing-pages`);
    await expect(page.getByRole('heading', { level: 1, name: 'Missing pages' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: missing });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expectNoAxeViolations(page);

    await row.getByRole('link', { name: /Redirect it/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Redirects' })).toBeVisible();
    await expect(page.getByLabel('Old address')).toHaveValue(missing);
    await page.getByLabel('Goes to').fill('/about');
    await page.getByRole('button', { name: 'Add redirect' }).click();
    await expect(page.getByRole('row').filter({ hasText: missing })).toContainText('Permanent');
    await expectNoAxeViolations(page);

    // The site redirects it (within the few seconds it reuses the list for).
    await expect
      .poll(async () => (await page.request.get(`http://localhost:4300${missing}`, { maxRedirects: 0 })).headers()['location'], { timeout: 15_000 })
      .toBe('/about');

    await page.getByRole('button', { name: `Delete the redirect from ${missing}` }).click();
    const dialog = page.getByRole('dialog', { name: `Delete the redirect from ${missing}?` });
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Delete redirect' }).click();
    await expect(page.getByRole('row').filter({ hasText: missing })).toHaveCount(0);
  });

  test('an editor sees how a page looks in search results and when shared, in the visual editor', async ({ page, request }) => {
    test.setTimeout(90_000);
    // Autosave may keep a draft of the change; the page is put back as published.
    const putBack = await keepPublished(request, space, about);
    try {
      await signIn(page, client);
      await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
      await page.goto(`/spaces/${space}/pages/${about}/edit`);
      await expect(page.getByText('Showing the draft of /about.')).toBeVisible({ timeout: 30_000 });

      await page.getByRole('tab', { name: 'SEO' }).click();
      const panel = page.getByRole('tabpanel', { name: 'SEO' });
      await expect(panel.getByRole('heading', { name: 'Search and sharing' })).toBeVisible();
      await expect(panel.locator('.nv-seo-result-title')).toHaveText('About | Novan demo site');
      await expect(panel.getByRole('img')).toBeVisible();
      await expect(panel).toContainText("The site's sharing image");
      await expectNoAxeViolations(page);

      // The search title counts its characters, and the preview follows; Undo takes it back.
      await panel.getByLabel('Search title').fill('About the Novan demo site');
      await expect(panel.getByLabel('Search title')).toHaveAccessibleDescription(/25 of 60 characters/);
      await expect(panel.locator('.nv-seo-result-title')).toHaveText('About the Novan demo site | Novan demo site');
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(panel.getByLabel('Search title')).toHaveValue('');
    } finally {
      await putBack();
    }
  });
});
