import { expect, test } from '@playwright/test';
import { client, signIn, signInAsAgency } from './support/auth';
import { expectNoAxeViolations } from './support/axe';

// Needs local Supabase (`npm run db:start && npm run db:reset`); the API and admin start automatically.

/** The seeded demo space (supabase/seed.sql). */
const demoSpaceId = '00000000-0000-4000-8000-000000000200';
const apiUrl = process.env['API_URL'] ?? 'http://localhost:3000';

test.describe('@api-tokens', () => {
  test('a developer creates a delivery token, copies it once, uses it, and revokes it', async ({ page }, testInfo) => {
    const name = `E2E website ${Date.now()} ${testInfo.project.name}`;

    await signInAsAgency(page);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'API tokens' })).toBeVisible();
    await expect(page).toHaveTitle('API tokens | Novan CMS');
    await expectNoAxeViolations(page);

    // A name is needed; the message is tied to the field.
    await page.getByRole('button', { name: 'Create token' }).click();
    const nameField = page.getByLabel('Name', { exact: true });
    await expect(nameField).toHaveAttribute('aria-invalid', 'true');
    await expect(nameField).toHaveAccessibleDescription(/Enter a name for the token\./);
    await expectNoAxeViolations(page);

    await nameField.fill(name);
    await expect(page.getByRole('radio', { name: 'Delivery' })).toBeChecked();
    await page.getByRole('button', { name: 'Create token' }).click();

    // The secret is shown once, and focus moves to it.
    await expect(page.getByRole('heading', { level: 2, name: 'Copy your new token' })).toBeFocused();
    const secret = page.getByLabel(`${name} (delivery token)`);
    const token = await secret.inputValue();
    expect(token).toMatch(/^nv_del_[A-Za-z0-9_-]{43}$/);
    const copy = page.getByRole('button', { name: 'Copy token' });
    // From the heading, Tab reaches the token, then the button (WebKit skips buttons when tabbing, as on macOS).
    if (testInfo.project.name !== 'webkit') {
      await page.keyboard.press('Tab');
      await expect(secret).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(copy).toBeFocused();
    } else {
      await copy.focus();
    }
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: /Copied|did not allow copying/ })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText(`nv_del_…${token.slice(-4)}`);
    await expectNoAxeViolations(page);

    // It reads the demo space's published content.
    const auth = { authorization: `Bearer ${token}` };
    expect((await page.request.get(`${apiUrl}/v1/delivery/sitemap`, { headers: auth })).status()).toBe(200);

    // Revoke, through a confirmation dialog.
    await page.getByRole('button', { name: `Revoke ${name}` }).click();
    const dialog = page.getByRole('dialog', { name: `Revoke ${name}?` });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Revoke token' }).click();
    await expect(page.getByText(`${name} is revoked.`)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Revoked');
    await expect(page.getByLabel(`${name} (delivery token)`)).toHaveCount(0);
    expect((await page.request.get(`${apiUrl}/v1/delivery/sitemap`, { headers: auth })).status()).toBe(401);
    await expectNoAxeViolations(page);
  });

  test('an editor has no Settings link and is sent away from the page', async ({ page }) => {
    await signIn(page, client);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Content' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings' })).toHaveCount(0);

    await page.goto(`/spaces/${demoSpaceId}/settings/api-tokens`);
    await expect(page.getByRole('heading', { level: 1, name: 'Content' })).toBeVisible();
  });
});
