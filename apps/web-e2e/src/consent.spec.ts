import { expect, type Page, test } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { waitForHydration } from './support/hydration';
import { WEBKIT_TAB_SKIPS_LINKS } from './support/keyboard';

async function consentCookie(page: Page): Promise<Record<string, unknown> | null> {
  const cookie = (await page.context().cookies()).find((candidate) => candidate.name === 'novan_consent');
  return cookie ? JSON.parse(decodeURIComponent(cookie.value)) : null;
}

const banner = (page: Page) => page.getByRole('dialog', { name: /We use cookies that this site needs/ });

test('a first visit shows the banner and sets nothing optional', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page).getByRole('button')).toHaveText(['Manage preferences', 'Reject all', 'Accept all']);
  // Accept and reject carry equal weight.
  await expect(banner(page).getByRole('button', { name: 'Reject all' })).toHaveClass(/btn-primary/);
  await expect(banner(page).getByRole('button', { name: 'Accept all' })).toHaveClass(/btn-primary/);
  await expect(banner(page).getByRole('link', { name: 'cookie policy' })).toHaveAttribute('href', '/cookies');
  expect(await consentCookie(page)).toBeNull();
  await expectNoAxeViolations(page);
});

test('the banner does not take focus on a first visit: the skip link stays the first stop', async ({ page, browserName }) => {
  // eslint-disable-next-line playwright/no-skipped-test -- a WebKit limitation, explained in WEBKIT_TAB_SKIPS_LINKS
  test.skip(browserName === 'webkit', WEBKIT_TAB_SKIPS_LINKS);
  await page.goto('/');
  await waitForHydration(page);
  await expect(banner(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
});

test('Reject all records the choice, and the banner stays closed on the next page', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await banner(page).getByRole('button', { name: 'Reject all' }).click();
  await expect(banner(page)).toBeHidden();
  expect(await consentCookie(page)).toEqual({ v: 1, analytics: false, marketing: false });

  await page.goto('/features');
  await waitForHydration(page);
  await expect(banner(page)).toBeHidden();
});

test('Cookie settings in the footer reopens the banner with focus, and gives focus back after', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await banner(page).getByRole('button', { name: 'Accept all' }).click();
  expect(await consentCookie(page)).toEqual({ v: 1, analytics: true, marketing: true });

  // By keyboard: Safari does not focus buttons on click, so there would be nothing to give focus back to.
  const settings = page.getByRole('contentinfo').getByRole('button', { name: 'Cookie settings' });
  await settings.press('Enter');
  await expect(banner(page).getByRole('button', { name: 'Accept all' })).toBeFocused();
  await banner(page).getByRole('button', { name: 'Reject all' }).press('Enter');
  await expect(settings).toBeFocused();
  expect(await consentCookie(page)).toEqual({ v: 1, analytics: false, marketing: false });
});

test('Manage preferences saves a choice per category; strictly necessary is always on', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await banner(page).getByRole('button', { name: 'Manage preferences' }).click();

  const dialog = page.getByRole('dialog', { name: 'Cookie preferences' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('switch', { name: /Strictly necessary/ })).toBeChecked();
  await expect(dialog.getByRole('switch', { name: /Strictly necessary/ })).toBeDisabled();
  await expect(dialog.getByRole('switch', { name: 'Analytics' })).not.toBeChecked();
  await expect(dialog.getByRole('switch', { name: 'Marketing' })).not.toBeChecked();
  await expectNoAxeViolations(page);

  await dialog.getByRole('switch', { name: 'Analytics' }).check();
  await dialog.getByRole('button', { name: 'Save choices' }).click();
  await expect(dialog).toBeHidden();
  await expect(banner(page)).toBeHidden();
  expect(await consentCookie(page)).toEqual({ v: 1, analytics: true, marketing: false });
});

test('the cookie policy lists the consent cookie and can reopen the banner', async ({ page }) => {
  await page.goto('/cookies');
  await waitForHydration(page);
  await banner(page).getByRole('button', { name: 'Reject all' }).click();

  const table = page.getByRole('table', { name: 'Cookies and storage this website uses' });
  await expect(table.getByRole('rowheader', { name: 'novan_consent' })).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: 'Cookie settings' }).click();
  await expect(banner(page)).toBeVisible();
});
