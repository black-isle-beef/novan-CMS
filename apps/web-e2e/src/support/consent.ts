import type { Page } from '@playwright/test';

/** Starts the page with "Reject all" already chosen, so the banner stays closed for tests about something else. */
export async function rejectCookies(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'novan_consent',
      value: encodeURIComponent(JSON.stringify({ v: 1, analytics: false, marketing: false })),
      url: process.env['BASE_URL'] || 'http://localhost:4100',
    },
  ]);
}
