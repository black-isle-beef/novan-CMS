import { expect, test } from '@playwright/test';

test('shows the sign-in placeholder', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page).toHaveTitle('Sign in | Novan CMS');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});
