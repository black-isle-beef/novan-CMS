import { expect, type Page } from '@playwright/test';

/**
 * Waits until Angular has hydrated the server-rendered page: it removes its hydration annotations (`ngh`)
 * when done. Before then a link click is an ordinary page load, not a client-side navigation.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[ngh]')).toHaveCount(0);
}
