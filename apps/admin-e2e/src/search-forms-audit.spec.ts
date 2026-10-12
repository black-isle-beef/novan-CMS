import { expect, type Page, test } from '@playwright/test';
import { signIn, spaceAdmin } from './support/auth';
import { expectNoAxeViolations } from './support/axe';
import { addRedirect } from './support/management';

// Package 18's admin screens in a real browser (docs/build/18-search-forms-audit.md): global search (Ctrl+K), the Forms
// inbox and the audit log, as the seeded space admin. Needs local Supabase (`npm run db:start && npm run db:reset`).

const demoSpaceId = '00000000-0000-4000-8000-000000000200';
const contactPageId = '00000000-0000-4000-8000-000000000703';
const contactFormId = '00000000-0000-4000-8000-000000000924';
const apiUrl = process.env['NOVAN_API_URL'] || 'http://localhost:3000';
/** The seeded delivery token (supabase/seed.sql): public, and useless outside a local database. */
const deliveryToken = 'nv_del_LocalStarterSiteDeliveryTokenSeedOnly000000';

const spaceMenu = (page: Page) => page.getByRole('navigation', { name: 'Space' });

/** Signs in as the space admin and opens the demo space's dashboard. */
async function openSpace(page: Page): Promise<void> {
  await signIn(page, spaceAdmin);
  await page.getByRole('link', { name: 'Demo site' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'What are we working on?' })).toBeVisible();
}

test.describe('@search-forms-audit', () => {
  test('Ctrl+K finds a page and opens it', async ({ page }) => {
    await openSpace(page);

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search Demo site' });
    const box = dialog.getByRole('combobox', { name: 'Find pages, entries and media' });
    await expect(box).toBeFocused();
    await box.fill('cont');
    await expect(dialog.getByRole('option', { name: /^Contact/ })).toBeVisible();
    await expect(box).toHaveAttribute('aria-activedescendant', `nv-search-page-${contactPageId}`);
    await expectNoAxeViolations(page);

    await box.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/spaces/${demoSpaceId}/content/${contactPageId}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Contact' })).toBeVisible();
  });

  test('a message sent through the site is in the Forms inbox, and can be read', async ({ page, request }, testInfo) => {
    const marker = `Admin e2e ${Date.now()} ${testInfo.project.name}`;
    const sent = await request.post(`${apiUrl}/v1/delivery/forms/${contactFormId}/submit`, {
      headers: { Authorization: `Bearer ${deliveryToken}`, 'X-Novan-Client-Ip': `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
      data: { entryId: contactPageId, data: { name: marker, email: 'visitor@example.com', message: 'Hello', consent: true } },
    });
    expect(sent.status(), await sent.text()).toBe(202);

    await openSpace(page);
    await spaceMenu(page).getByRole('link', { name: 'Forms' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Forms' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: marker });
    await row.getByRole('button', { name: /^Read/ }).click();
    const detail = page.getByRole('region', { name: /^Message of/ });
    await expect(detail.getByRole('heading')).toBeFocused();
    await expect(detail.locator('dd').first()).toHaveText(marker);
    await expect(page.getByLabel('Email new messages to')).toHaveValue('forms@example.com');
    await expectNoAxeViolations(page);
  });

  test('the audit log filters by what happened and shows an event\'s details', async ({ page, request }, testInfo) => {
    // Its own event, rather than one another journey (site.spec.ts) may or may not have left.
    const removeRedirect = await addRedirect(request, demoSpaceId, `/e2e-audit-${testInfo.project.name}-${Date.now()}`, '/about');
    try {
      await openSpace(page);
      await spaceMenu(page).getByRole('link', { name: 'Audit log' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
      await page.getByLabel('What happened').selectOption({ label: 'Added a redirect' });
      await page.getByRole('button', { name: 'Filter' }).click();
      await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'The list shows only the changes you chose.' }).first()).toBeVisible();
      const rows = page.getByRole('table').getByRole('row');
      await expect(rows.nth(1)).toBeVisible();
      for (const header of await page.getByRole('table').getByRole('rowheader').all()) await expect(header).toHaveText('Added a redirect');

      await rows.nth(1).getByRole('button', { name: /^Details/ }).click();
      await expect(page.getByRole('heading', { name: 'Added a redirect: what was recorded' })).toBeFocused();
      await expectNoAxeViolations(page);
    } finally {
      await removeRedirect();
    }
  });
});
