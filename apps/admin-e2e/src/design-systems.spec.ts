import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { developer, signIn } from './support/auth';
import { expectNoAxeViolations } from './support/axe';
import { detachDesignSystems, keepPublished } from './support/management';

// Design systems (docs/build/24-design-systems.md, 24c). Needs local Supabase, like editor.spec.ts; the demo space has
// design systems turned on in the seed. The site loads nothing afterwards, and the Contact page is as it was.
const demoSpaceId = '00000000-0000-4000-8000-000000000200';
const contactId = '00000000-0000-4000-8000-000000000703';
const stylesheet = resolve(__dirname, 'fixtures/design-systems/bootstrap-only.css');

test.describe('@design-systems', () => {
  test('a developer uploads a stylesheet, the site loads it, and an editor adds its classes at a screen size', async ({ page, request }) => {
    test.setTimeout(150_000);
    const run = Date.now();
    const putBack = await keepPublished(request, demoSpaceId, contactId);
    try {
      await signIn(page, developer);
      await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
      await page.goto(`/spaces/${demoSpaceId}/settings/design-systems`);
      await expect(page.getByRole('heading', { level: 1, name: 'Design systems' })).toBeVisible();

      // A design system, then its first version from a file.
      await page.getByLabel('Name', { exact: true }).fill(`E2E Bootstrap ${run}`);
      await page.getByLabel('Short name', { exact: true }).fill(`e2e-${run}`);
      await page.getByLabel('Framework').selectOption({ label: 'Bootstrap' });
      await page.getByRole('button', { name: 'Add design system' }).click();
      await expect(page.getByRole('heading', { level: 2, name: new RegExp(`E2E Bootstrap ${run}`) })).toBeVisible();

      await page.getByLabel('Design system', { exact: true }).selectOption({ label: `E2E Bootstrap ${run}` });
      await page.getByLabel('Version', { exact: true }).fill('1.0.0');
      await page.getByLabel('CSS file').setInputFiles(stylesheet);
      await page.getByRole('button', { name: 'Add version' }).click();
      const versions = page.getByRole('table', { name: `Versions of E2E Bootstrap ${run}` });
      await expect(versions.getByText('Ready')).toBeVisible({ timeout: 30_000 });
      // What checking it found: the javascript: URL went.
      await versions.getByText(/What checking 1\.0\.0 found/).click();
      await expect(versions).toContainText('background was removed: it links to javascript: addresses.');

      // On the site.
      await page.getByLabel('Add to the site').selectOption({ label: `E2E Bootstrap ${run} 1.0.0` });
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('button', { name: 'Save what the site loads' }).click();
      await expect(page.getByRole('status')).toHaveText('Saved. The site loads these design systems from its next page view.');
      await expectNoAxeViolations(page);

      // In the editor: the site has the stylesheet, and Bootstrap's breakpoints are offered.
      await page.goto(`/spaces/${demoSpaceId}/pages/${contactId}/edit`);
      await expect(page.getByText('Showing the draft of /contact.')).toBeVisible({ timeout: 30_000 });
      const frame = page.frameLocator('iframe[title="Draft of Contact"]');
      await expect(frame.locator('link[data-novan-ds]')).toHaveAttribute('href', /\/v1\/design-system-files\/.+\/bootstrap-only\.css$/);
      await frame.locator('[data-novan-block="hero"]').first().click();
      const panel = page.getByRole('complementary', { name: 'Block' });
      await panel.getByLabel('Applies').selectOption({ label: 'Medium screens and up' });
      const classes = panel.getByRole('combobox', { name: 'Classes on Whole block, medium screens and up' });
      await classes.pressSequentially('px-');
      await expect(panel.getByRole('listbox')).toContainText('px-3');
      await classes.press('ArrowDown');
      await classes.press('Enter');
      const hero = frame.locator('[data-novan-block="hero"] [data-novan-part="root"]').first();
      await expect(hero).toHaveClass(/(^|\s)px-md-3(\s|$)/);
      await expectNoAxeViolations(page);
      await panel.getByRole('button', { name: 'Clear all classes' }).click();
      await expect(hero).not.toHaveClass(/px-md-3/);
    } finally {
      await detachDesignSystems(request, demoSpaceId);
      await putBack();
    }
  });
});
