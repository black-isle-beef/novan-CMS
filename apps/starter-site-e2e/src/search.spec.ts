import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { waitForHydration } from './support/hydration';

// Site search (docs/build/18-search-forms-audit.md): `/search` uses the SDK's <novan-search> over the published pages.

test.describe('@search', () => {
  test('a search in the address shows its results, rendered on the server, and is kept out of search engines', async ({ page }) => {
    await page.goto('/search?q=blocks');
    const results = page.getByRole('list', { name: 'Results for blocks' });
    await expect(results.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
    await expect(results.locator('mark').first()).toHaveText(/^block/i);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expectNoAxeViolations(page);
  });

  test('searching as you type updates the results and the address', async ({ page }) => {
    await page.goto('/search');
    await waitForHydration(page);
    await page.getByRole('searchbox', { name: 'Search this site' }).fill('contact');
    await expect(page.getByRole('status')).toHaveText(/result(s)? for “contact”\.$/);
    await expect(page.getByRole('list', { name: 'Results for contact' }).getByRole('link', { name: 'Contact' })).toBeVisible();
    await expect(page).toHaveURL(/\/search\?q=contact$/);
  });
});
