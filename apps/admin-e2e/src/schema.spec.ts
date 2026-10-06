import { expect, type Page, test } from '@playwright/test';
import { client, signIn, signInAsAgency } from './support/auth';
import { expectNoAxeViolations } from './support/axe';

// Needs local Supabase (`npm run db:start && npm run db:reset`); the API and admin start automatically.

/** The seeded demo space (supabase/seed.sql). */
const demoSpaceId = '00000000-0000-4000-8000-000000000200';

/** Field labels in the builder's list, in order. */
const fieldOrder = (page: Page) => page.locator('ol.list-group > li .fw-semibold');

/** Adds a field from the palette and gives it a label in the settings panel. */
async function addField(page: Page, type: RegExp, label: string): Promise<void> {
  await page.getByRole('button', { name: type }).click();
  const panel = page.getByRole('region', { name: /^Settings for / });
  await panel.getByLabel('Label', { exact: true }).fill(label);
  await panel.getByRole('button', { name: `Done with ${label}` }).click();
}

test.describe('@schema', () => {
  test('a developer creates a content type, adds and reorders fields, and they survive a reload', async ({
    page,
  }, testInfo) => {
    const name = `E2E article ${Date.now()} ${testInfo.project.name}`;

    await signInAsAgency(page);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    // The seeded model is listed.
    await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Schema' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Schema' })).toBeVisible();
    for (const type of ['Page', 'Page not found', 'Hero', 'Rich text', 'Image', 'Feature grid', 'Call to action']) {
      await expect(page.getByRole('rowheader', { name: type, exact: true })).toBeVisible();
    }
    await expectNoAxeViolations(page);

    // Create a type with three fields.
    await page.getByRole('link', { name: 'New content type' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New content type' })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('radio', { name: 'Entry' }).check();

    await addField(page, /^Text\b/, 'Headline');
    await addField(page, /^Number\b/, 'Reading time');
    await addField(page, /^Yes or no\b/, 'Featured');
    await expect(fieldOrder(page)).toHaveText(['Headline', 'Reading time', 'Featured']);

    // Reorder with the keyboard-friendly buttons (drag and drop has the same result).
    await page.getByRole('button', { name: 'Move Featured up' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'moved' })).toHaveText('Featured moved to position 2 of 3.');
    await page.getByRole('button', { name: 'Move Featured up' }).click();
    await expect(fieldOrder(page)).toHaveText(['Featured', 'Headline', 'Reading time']);
    await expect(page.getByRole('button', { name: 'Move Featured down' })).toBeFocused();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Create content type' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Created. You can keep adding fields.')).toBeVisible();

    // Still there, in the same order, after a reload.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(fieldOrder(page)).toHaveText(['Featured', 'Headline', 'Reading time']);
    await expectNoAxeViolations(page);

    // Clean up through the UI.
    await page.getByRole('button', { name: 'Delete content type' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Schema' })).toBeVisible();
    await expect(page.getByText(`Deleted ${name}.`)).toBeVisible();
    await expect(page.getByRole('rowheader', { name })).toHaveCount(0);
  });

  test('an editor sees no schema link and cannot open the schema screens', async ({ page }) => {
    await signIn(page, client);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Schema' })).toHaveCount(0);

    // Blocked schema screens send the editor to the space's home, its dashboard.
    for (const path of ['schema', 'schema/new/content-type', 'schema/block-types/hero']) {
      await page.goto(`/spaces/${demoSpaceId}/${path}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    }
  });
});
