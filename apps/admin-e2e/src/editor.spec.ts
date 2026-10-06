import { expect, test } from '@playwright/test';
import { client, signIn } from './support/auth';
import { expectNoAxeViolations } from './support/axe';

// Needs local Supabase (`npm run db:start && npm run db:reset`); the API, admin and starter site start
// automatically. The demo space's site is the starter site at http://localhost:4300 (supabase/seed.sql), with
// the seeded preview token (apps/starter-site/.env.serve).

test.describe('@editor', () => {
  test('an editor opens the home page on the site, picks a screen size and selects the hero', async ({ page }) => {
    // The site's first render compiles on demand in the dev server.
    test.setTimeout(90_000);
    await signIn(page, client);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Pages' }).click();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.getByRole('link', { name: 'Edit on the page' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    // The site, in preview mode, tells the admin it is ready.
    await expect(page.getByText('Showing the draft of /.')).toBeVisible({ timeout: 30_000 });
    const frame = page.frameLocator('iframe[title="Draft of Home"]');
    const hero = frame.locator('[data-novan-block="hero"]').first();
    await expect(hero).toBeVisible();

    // Clicking the hero selects it: outlined on the page, named in the panel.
    await hero.click();
    await expect(page.getByRole('complementary', { name: 'Block' })).toContainText('Hero');
    await expect(frame.locator('[data-novan-overlay]')).toContainText('Hero');

    // Screen sizes are a radio group: arrow keys move between them.
    await page.locator('label[for="nv-editor-device-mobile"]').click();
    await expect(page.getByRole('radio', { name: /Mobile/ })).toBeChecked();
    await expect(page.locator('iframe.nv-editor-frame-mobile')).toBeVisible();
    await page.getByRole('radio', { name: /Mobile/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: /Tablet/ })).toBeChecked();
    await expect(page.locator('iframe.nv-editor-frame-tablet')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a preview link with a made-up token shows no drafts', async ({ page }) => {
    const response = await page.goto('http://localhost:4300/?novan_preview=made.up');
    expect(response?.headers()['cache-control']).not.toBe('private, no-store');
    await expect(page.locator('[data-novan-uid]')).toHaveCount(0);
  });
});
