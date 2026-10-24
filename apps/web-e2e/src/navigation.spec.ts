import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { rejectCookies } from './support/consent';
import { waitForHydration } from './support/hydration';
import { WEBKIT_TAB_SKIPS_LINKS } from './support/keyboard';

test.beforeEach(async ({ page }) => {
  await rejectCookies(page);
});

test('the header has the logo, every page, sign-in to the CMS and the call to action', async ({ page }) => {
  await page.goto('/pricing');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Features', 'Pricing', 'Contact']);
  await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page');

  const banner = page.getByRole('banner');
  await expect(banner.getByRole('link', { name: 'Novan CMS, home' })).toHaveAttribute('href', '/');
  // The admin's sign-in page, from CMS_LOGIN_URL (else ADMIN_URL + /sign-in): a plain link to another app.
  await expect(banner.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /^https?:\/\/[^/]+\/sign-in$/);
  await expect(banner.getByRole('link', { name: 'Book a demo' })).toHaveAttribute('href', '/contact?enquiry=demo');
});

test('the skip link is the first stop and moves to the main content', async ({ page, browserName }) => {
  // eslint-disable-next-line playwright/no-skipped-test -- a WebKit limitation, explained in WEBKIT_TAB_SKIPS_LINKS
  test.skip(browserName === 'webkit', WEBKIT_TAB_SKIPS_LINKS);
  await page.goto('/features');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#ds-main-content');
});

test('moving to another page puts focus on its heading', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Pricing' }).click();
  await expect(page).toHaveURL('/pricing');
  await expect(page.getByRole('heading', { level: 1, name: 'Pricing' })).toBeFocused();
  await expect(page).toHaveTitle('Pricing | Novan CMS');
});

test('a feature highlight leads to, and focuses, its section on /features', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await page.getByRole('link', { name: 'Users, roles and permissions' }).click();
  await expect(page).toHaveURL('/features#roles');
  await expect(page.locator('#roles')).toBeFocused();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test('the menu opens from its button, closes on Escape and gives focus back', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);
    const toggle = page.getByRole('button', { name: 'Open main menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'ds-main-nav-menu');

    await toggle.click();
    const close = page.getByRole('button', { name: 'Close main menu' });
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    const features = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Features' });
    await expect(features).toBeVisible();
    await expectNoAxeViolations(page);

    await features.focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open main menu' })).toBeFocused();
    await expect(features).toBeHidden();
  });

  test('following a menu link closes the menu', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Open main menu' }).click();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Contact' }).click();
    await expect(page).toHaveURL('/contact');
    await expect(page.getByRole('button', { name: 'Open main menu' })).toHaveAttribute('aria-expanded', 'false');
  });
});
