import { expect, test } from '@playwright/test';
import { authLinkFromEmail, client, signIn, signInAsAgency, signOut } from './support/auth';

// Needs local Supabase (`npm run db:start && npm run db:reset`); the API and admin start automatically.

test.describe('@auth', () => {
  test('Gate 0: agency creates a space and invites a client, who sees only that space', async ({ page }, testInfo) => {
    const run = `${Date.now()}-${testInfo.project.name}`;
    const clientEmail = `client+${run}@novan.test`;

    // Agency user signs in with two-step verification.
    await signInAsAgency(page);

    // Creates "Acme Ltd".
    await page.getByRole('link', { name: 'Create a space' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Create a space' })).toBeVisible();
    await page.getByLabel('Client or site name').fill('Acme Ltd');
    await expect(page.getByLabel('Short name')).toHaveValue('acme-ltd');
    await page.getByLabel('Short name').fill(`acme-ltd-${run}`.toLowerCase());
    await page.getByRole('button', { name: 'Create space' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
    await expect(page.getByText('Who can sign in to Acme Ltd')).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /Agency User/ })).toBeVisible();

    // Invites the client as an editor.
    await page.getByLabel('Email').fill(clientEmail);
    await page.getByRole('radio', { name: 'Editor' }).check();
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText(`Invited ${clientEmail} as editor.`)).toBeVisible();
    await expect(page.getByRole('combobox', { name: `Role for ${clientEmail}` })).toHaveValue('editor');

    await signOut(page);

    // The client accepts the invite and chooses a password.
    await page.goto(await authLinkFromEmail(clientEmail));
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Novan CMS' })).toBeVisible();
    await expect(page.getByText(clientEmail)).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill('client-password-1');
    await page.getByLabel('Confirm new password').fill('client-password-1');
    await page.getByRole('button', { name: 'Save password and continue' }).click();

    // ... and sees only Acme Ltd, with no agency tools.
    await expect(page.getByRole('heading', { level: 1, name: 'Spaces' })).toBeVisible();
    const spaces = page.getByRole('main').getByRole('listitem');
    await expect(spaces).toHaveCount(1);
    await expect(spaces.first()).toContainText('Acme Ltd');
    await expect(spaces.first()).toContainText('Editor');
    await expect(page.getByRole('link', { name: 'Create a space' })).toHaveCount(0);

    // Signing in again with the new password works.
    await signOut(page);
    await signIn(page, { email: clientEmail, password: 'client-password-1' });
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1);
  });

  test('a client without agency rights signs in without a second factor and cannot create spaces', async ({ page }) => {
    await signIn(page, client);

    await expect(page.getByRole('heading', { level: 1, name: 'Spaces' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create a space' })).toHaveCount(0);

    await page.goto('/spaces/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Spaces' })).toBeVisible();
  });

  test('signed-in pages: skip link first, current page marked, focus moves to the new heading', async ({
    page,
    browserName,
  }) => {
    await signIn(page, client);
    await expect(page.getByRole('heading', { level: 1, name: 'Spaces' })).toBeVisible();

    // WebKit does not Tab to links by default (Safari's "Press Tab to highlight each item"), and
    // Playwright's WebKit build ignores Option+Tab, so the skip link is checked in the other browsers.
    if (browserName !== 'webkit') {
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Spaces' })).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    }

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Spaces' })).toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Account' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeFocused();
    await expect(nav.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
  });

  test('a wrong password shows an error and stays on sign in', async ({ page }) => {
    await signIn(page, { email: client.email, password: 'wrong-password' });

    await expect(page.getByRole('alert')).toContainText('Your email or password is incorrect.');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('signed-out visitors are sent to sign in and returned afterwards', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/sign-in\?returnUrl=%2Faccount$/);
    await expect(page).toHaveTitle('Sign in | Novan CMS');

    await page.getByLabel('Email').fill(client.email);
    await page.getByLabel('Password').fill(client.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  });
});
