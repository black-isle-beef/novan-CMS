import { expect, test } from '@playwright/test';

test('home page content is rendered on the server', async ({ page, request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('Welcome');

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible();
});
